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
  /** Commit the build ran against. This is what ties a build to the page being viewed. */
  sourceVersion: string;
  definition?: { name?: string };
}

interface AzureArtifact {
  name: string;
  resource?: { downloadUrl?: string; type?: string };
}

/**
 * Azure DevOps expects a PAT as the *password* of HTTP basic auth with an empty username.
 * `btoa` is available in both the service worker and the page, and a PAT is ASCII.
 */
function authHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Basic ${btoa(`:${token}`)}`,
  };
}

function describeFailure(status: number, what: string): never {
  if (status === 401 || status === 203) {
    // Azure DevOps answers an unauthenticated API call with a sign-in page and a
    // surprising 203, rather than a 401, which is otherwise baffling to diagnose.
    throw new CoverageResolutionError(
      `Not authorised while ${what}.`,
      'Add an Azure DevOps personal access token with Build (read) scope in GutterHub options.',
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

  if (!response.ok) {
    describeFailure(response.status, what);
  }

  return (await response.json()) as T;
}

/**
 * Finds the build that ran against a commit.
 *
 * The Azure DevOps builds API has no `sourceVersion` filter, so the only way to do this
 * is to list recent builds for the repository and match client-side. Filtering by
 * repository first keeps that list short even on a busy organisation.
 */
async function findBuild(
  source: Extract<CoverageSource, { kind: 'azure-devops' }>,
  request: ResolveRequest,
  token: string,
): Promise<AzureBuild> {
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
  const matching = builds.filter((build) => build.sourceVersion === sha);

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
  })[0]!;
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
    if (token.length === 0) {
      throw new CoverageResolutionError(
        'An Azure DevOps token is required to download build artifacts.',
        'Add one with Build (read) scope in GutterHub options. This is separate from the GitHub token.',
      );
    }

    if (!source.organisation || !source.project) {
      throw new CoverageResolutionError(
        'Azure DevOps organisation and project are required.',
        'Set them in the GutterHub popup.',
      );
    }

    const build = await findBuild(source, request, token);

    const artifactsUrl =
      `https://dev.azure.com/${encodeURIComponent(source.organisation)}` +
      `/${encodeURIComponent(source.project)}/_apis/build/builds/${build.id}` +
      `/artifacts?api-version=${API_VERSION}`;

    const artifacts = await getJson<{ value?: AzureArtifact[] }>(
      artifactsUrl,
      token,
      `listing artifacts for build ${build.buildNumber}`,
    );

    const artifact = chooseArtifact(artifacts.value ?? [], source.artifactName);
    if (!artifact) {
      throw new CoverageResolutionError(
        `No artifact matching "${source.artifactName}" on build ${build.buildNumber}.`,
        (artifacts.value ?? []).length > 0
          ? `Artifacts on that build: ${(artifacts.value ?? []).map((item) => item.name).join(', ')}`
          : 'That build published no artifacts.',
      );
    }

    let archive: Response;
    try {
      archive = await fetch(artifact.resource!.downloadUrl!, {
        headers: authHeaders(token),
        credentials: 'omit',
      });
    } catch (error) {
      throw new CoverageResolutionError(
        `Could not download artifact "${artifact.name}".`,
        error instanceof Error ? error.message : undefined,
      );
    }

    if (!archive.ok) {
      describeFailure(archive.status, `downloading artifact "${artifact.name}"`);
    }

    const entry = readArchive(new Uint8Array(await archive.arrayBuffer()), source.entryName);

    return {
      text: entry.text,
      label: `${build.definition?.name ?? 'Azure Pipelines'} #${build.buildNumber} › ${artifact.name} › ${entry.name}`,
      fileName: entry.name,
    };
  },
};

/** @internal Exported for testing. */
export { chooseArtifact };
