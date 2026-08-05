import { readArchive } from './archive.js';
import {
  CoverageResolutionError,
  globMatch,
  type CoverageProvider,
  type ResolveRequest,
} from './types.js';
import type { CoverageSource } from '../shared/settings.js';

/**
 * Azure DevOps build artifacts.
 *
 * This is the case where a repository lives on GitHub but its CI runs in Azure Pipelines,
 * which is common in Microsoft-adjacent repositories — `microsoft/testfx` publishes its
 * coverage exactly this way. GitHub's own Actions API knows nothing about those builds,
 * so a separate provider is required.
 *
 * Note that Azure DevOps authenticates with **its own** personal access token, not a
 * GitHub one; the two are unrelated and are stored separately.
 */

const API_VERSION = '7.1';

interface AzureBuild {
  id: number;
  buildNumber: string;
  status: string;
  result: string | null;
  /**
   * Commit the build ran against. For a pull request validation build this is the
   * *synthetic merge* commit Azure creates, not the head of the PR branch.
   */
  sourceVersion: string;
  sourceBranch?: string;
  /**
   * Source-provider specific trigger data. For a GitHub pull request build this carries
   * `pr.sourceSha`, which is the head commit GitHub shows on the PR page.
   */
  triggerInfo?: Record<string, string>;
  definition?: { name?: string };
}

/**
 * Every commit a build can reasonably be said to be "for".
 *
 * A pull request validation build records the merge commit in `sourceVersion` while
 * GitHub's PR page — and therefore `resolveSha` — reports the head of the PR branch.
 * Matching on `sourceVersion` alone silently misses every PR build, which is the case
 * this provider exists to serve.
 */
export function buildCommits(build: AzureBuild): string[] {
  const commits = [build.sourceVersion];

  const prHead = build.triggerInfo?.['pr.sourceSha'];
  if (prHead) {
    commits.push(prHead);
  }

  return commits.filter((commit): commit is string => Boolean(commit));
}

interface AzureArtifact {
  name: string;
  resource?: { downloadUrl?: string; type?: string };
}

/**
 * Public Azure DevOps projects allow anonymous artifact reads. Private projects expect a
 * PAT as the password of HTTP basic auth with an empty username.
 */
function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) {
    headers.Authorization = `Basic ${btoa(`:${token}`)}`;
  }
  return headers;
}

/**
 * Rejects a response that did not carry usable JSON.
 *
 * The 203 check is not redundant with `response.ok`: fetch defines `ok` as any 2xx, and
 * Azure DevOps answers an unauthenticated API call with **203 and an HTML sign-in page**
 * rather than a 401. Relying on `ok` alone therefore sails straight past the auth failure
 * and tries to parse that page as JSON.
 */
function ensureOk(response: Response, what: string): void {
  if (response.status === 203 || !response.ok) {
    describeFailure(response.status, what);
  }
}

/**
 * Origins the Azure DevOps source needs, beyond the API host itself.
 *
 * A build artifact's `downloadUrl` frequently points at a regional artifact service —
 * `artprodcus3.artifacts.visualstudio.com` and friends — rather than `dev.azure.com`, and
 * may redirect again. In MV3 a fetch to an origin the extension has not been granted
 * fails at the host-permission boundary, before any of the response handling runs, so
 * these have to be granted alongside the API host.
 */
export const AZURE_ORIGINS = [
  'https://dev.azure.com/*',
  'https://*.dev.azure.com/*',
  'https://*.artifacts.visualstudio.com/*',
  'https://*.visualstudio.com/*',
];

/**
 * Checks that a download URL's origin has actually been granted, so that a missing
 * permission is reported as such rather than surfacing as an opaque network error.
 *
 * `chrome.permissions` is absent in tests, in which case there is nothing to verify.
 */
async function ensureDownloadable(url: string): Promise<void> {
  const permissions = (globalThis as { chrome?: typeof chrome }).chrome?.permissions;
  if (!permissions?.contains) {
    return;
  }

  let origin: string;
  try {
    origin = `${new URL(url).origin}/*`;
  } catch {
    return;
  }

  if (await permissions.contains({ origins: [origin] })) {
    return;
  }

  throw new CoverageResolutionError(
    `GutterHub is not allowed to download from ${new URL(url).host}.`,
    'Azure DevOps serves artifacts from regional hosts. Open the GutterHub popup and ' +
      'press Save to grant access, which has to be done from a click.',
  );
}

function describeFailure(status: number, what: string): never {
  if (status === 401 || status === 203) {
    throw new CoverageResolutionError(
      `Not authorised while ${what}.`,
      'Public projects need no token. For a private project, add an Azure DevOps personal ' +
        'access token with Build (read) scope in GutterHub options.',
    );
  }

  if (status === 404) {
    throw new CoverageResolutionError(
      `Nothing found while ${what}.`,
      'Check the organisation and project names.',
    );
  }

  throw new CoverageResolutionError(`Request failed while ${what} (HTTP ${status}).`);
}

async function getJson<T>(url: string, token: string, what: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: authHeaders(token), credentials: 'omit' });
  } catch (error) {
    throw new CoverageResolutionError(
      `Could not reach Azure DevOps while ${what}.`,
      error instanceof Error ? error.message : undefined,
    );
  }

  ensureOk(response, what);

  return (await response.json()) as T;
}

/**
 * Finds the builds that ran against a commit, best first.
 *
 * The Azure DevOps builds API has no `sourceVersion` filter, so the only way to do this
 * is to list recent builds for the repository and match client-side. Filtering by
 * repository first keeps that list short even on a busy organisation.
 *
 * Every match is returned rather than just the newest: several pipelines can build one
 * commit, and only some of them publish coverage. Picking the most recent alone would
 * report "no artifact" whenever an unrelated pipeline happened to finish last.
 */
async function findBuilds(
  source: Extract<CoverageSource, { kind: 'azure-devops' }>,
  request: ResolveRequest,
  token: string,
): Promise<AzureBuild[]> {
  const { context, sha } = request;
  const base = `https://dev.azure.com/${encodeURIComponent(source.organisation)}/${encodeURIComponent(source.project)}/_apis/build/builds`;

  const query = new URLSearchParams({
    'api-version': API_VERSION,
    repositoryType: 'GitHub',
    repositoryId: `${context.owner}/${context.repo}`,
    queryOrder: 'queueTimeDescending',
    $top: '200',
  });

  if (source.definitionId) {
    query.set('definitions', source.definitionId);
  }

  const result = await getJson<{ value?: AzureBuild[] }>(
    `${base}?${query.toString()}`,
    token,
    `listing builds for ${context.owner}/${context.repo}`,
  );

  const builds = result.value ?? [];
  const matching = builds.filter((build) => buildCommits(build).includes(sha));

  if (matching.length === 0) {
    throw new CoverageResolutionError(
      `No Azure DevOps build found for commit ${sha.slice(0, 7)}.`,
      builds.length === 0
        ? 'No builds at all were returned — check the organisation, project, and that the pipeline builds this GitHub repository.'
        : `Searched the ${builds.length} most recent builds. Coverage appears once CI has run for this commit.`,
    );
  }

  // Completed builds first, then most recent, so an in-flight rerun does not hide a
  // finished build that already published its artifacts.
  return matching.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'completed' ? -1 : 1;
    }
    return b.id - a.id;
  });
}

function chooseArtifact(
  artifacts: readonly AzureArtifact[],
  pattern: string,
): AzureArtifact | null {
  const downloadable = artifacts.filter((artifact) => artifact.resource?.downloadUrl);

  return (
    downloadable.find((artifact) => globMatch(pattern, artifact.name)) ??
    downloadable.find((artifact) => /coverage|mutation/i.test(artifact.name)) ??
    null
  );
}

export const azureDevOpsProvider: CoverageProvider = {
  kind: 'azure-devops',

  async resolve(source: CoverageSource, request: ResolveRequest) {
    if (source.kind !== 'azure-devops') {
      throw new CoverageResolutionError('Wrong provider for this source.');
    }

    const token = request.azureToken ?? '';

    if (!source.organisation || !source.project) {
      throw new CoverageResolutionError(
        'Azure DevOps organisation and project are required.',
        'Set them in the GutterHub popup.',
      );
    }

    const builds = await findBuilds(source, request, token);
    const problems: string[] = [];

    // Walk the matching builds until one yields an artifact. Several pipelines can build
    // the same commit and only some publish coverage, so stopping at the first build
    // would report a false failure whenever an unrelated one finished most recently.
    for (const build of builds) {
      const artifactsUrl =
        `https://dev.azure.com/${encodeURIComponent(source.organisation)}` +
        `/${encodeURIComponent(source.project)}/_apis/build/builds/${build.id}` +
        `/artifacts?api-version=${API_VERSION}`;

      const artifacts = await getJson<{ value?: AzureArtifact[] }>(
        artifactsUrl,
        token,
        `listing artifacts for build ${build.buildNumber}`,
      );

      const available = artifacts.value ?? [];
      const artifact = chooseArtifact(available, source.artifactName);

      if (!artifact) {
        if (available.length > 0) {
          problems.push(`${build.buildNumber}: ${available.map((item) => item.name).join(', ')}`);
        }
        continue;
      }

      const downloadUrl = artifact.resource!.downloadUrl!;
      await ensureDownloadable(downloadUrl);

      let archive: Response;
      try {
        archive = await fetch(downloadUrl, {
          headers: authHeaders(token),
          credentials: 'omit',
        });
      } catch (error) {
        throw new CoverageResolutionError(
          `Could not download artifact "${artifact.name}".`,
          error instanceof Error ? error.message : undefined,
        );
      }

      // The download is subject to the same 203 sign-in response as the API, and handing
      // an HTML page to the unzipper would report a corrupt archive instead of the real
      // authentication problem.
      ensureOk(archive, `downloading artifact "${artifact.name}"`);

      const entry = readArchive(new Uint8Array(await archive.arrayBuffer()), source.entryName);

      return {
        text: entry.text,
        label: `${build.definition?.name ?? 'Azure Pipelines'} #${build.buildNumber} › ${artifact.name} › ${entry.name}`,
        fileName: entry.name,
      };
    }

    throw new CoverageResolutionError(
      `No artifact matching "${source.artifactName}" on any build for commit ${request.sha.slice(0, 7)}.`,
      problems.length > 0
        ? `Artifacts found: ${problems.join(' | ')}`
        : 'Those builds published no artifacts.',
    );
  },
};

/** @internal Exported for testing. */
export { chooseArtifact };
