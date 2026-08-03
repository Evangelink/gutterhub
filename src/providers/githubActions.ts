import { unzipSync } from 'fflate';
import { detectFormat } from '../core/parsers/index.js';
import type { CoverageSource } from '../shared/settings.js';
import { GitHubApi, type WorkflowArtifact } from './githubApi.js';
import {
  CoverageResolutionError,
  globMatch,
  type CoverageProvider,
  type ResolveRequest,
} from './types.js';

/** Entries larger than this are skipped: coverage reports are text, not binaries. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

const LIKELY_COVERAGE_NAME = /(lcov|cobertura|coverage|clover|opencover|\.info$)/i;

/** @internal Exported for testing. */
export function chooseArtifact(
  artifacts: readonly WorkflowArtifact[],
  pattern: string,
): WorkflowArtifact | null {
  const live = artifacts.filter((artifact) => !artifact.expired);
  const matching = live.filter((artifact) => globMatch(pattern, artifact.name));

  // Multiple matches happen on matrix builds (`coverage-net8.0`, `coverage-net9.0`).
  // The largest artifact is the best single guess at the most complete report.
  return (
    matching.sort((a, b) => b.size_in_bytes - a.size_in_bytes)[0] ??
    live.filter((artifact) => LIKELY_COVERAGE_NAME.test(artifact.name))[0] ??
    null
  );
}

interface ArchiveEntry {
  name: string;
  text: string;
}

/** @internal Exported for testing. */
export function readArchive(archive: Uint8Array, entryName: string | undefined): ArchiveEntry {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (error) {
    throw new CoverageResolutionError(
      'Artifact archive could not be read.',
      error instanceof Error ? error.message : undefined,
    );
  }

  const decoder = new TextDecoder();
  const candidates = Object.entries(files).filter(
    ([name, bytes]) => bytes.length > 0 && bytes.length <= MAX_ENTRY_BYTES && !name.endsWith('/'),
  );

  if (candidates.length === 0) {
    throw new CoverageResolutionError('Artifact archive is empty.');
  }

  if (entryName && entryName.trim().length > 0) {
    const wanted = candidates.find(([name]) => globMatch(entryName.trim(), name));
    if (!wanted) {
      throw new CoverageResolutionError(
        `No entry matching "${entryName}" in the artifact.`,
        `Archive contains: ${candidates
          .slice(0, 10)
          .map(([name]) => name)
          .join(', ')}`,
      );
    }
    return { name: wanted[0], text: decoder.decode(wanted[1]) };
  }

  // Try the plausibly-named entries first so a report sitting beside logs and dumps
  // is found without decoding the whole archive.
  const ordered = [
    ...candidates.filter(([name]) => LIKELY_COVERAGE_NAME.test(name)),
    ...candidates.filter(([name]) => !LIKELY_COVERAGE_NAME.test(name)),
  ];

  for (const [name, bytes] of ordered) {
    const text = decoder.decode(bytes);
    if (detectFormat(text, name) !== null) {
      return { name, text };
    }
  }

  throw new CoverageResolutionError(
    'No recognisable coverage report inside the artifact.',
    `Archive contains: ${candidates
      .slice(0, 10)
      .map(([name]) => name)
      .join(', ')}`,
  );
}

/** Pulls a coverage report out of a GitHub Actions artifact for the head commit. */
export const githubActionsProvider: CoverageProvider = {
  kind: 'github-actions',

  async resolve(source: CoverageSource, request: ResolveRequest) {
    if (source.kind !== 'github-actions') {
      throw new CoverageResolutionError('Wrong provider for this source.');
    }

    const { context, sha, token } = request;

    if (token.length === 0) {
      // Artifact download is authenticated even for public repositories.
      throw new CoverageResolutionError(
        'A GitHub token is required to download Actions artifacts.',
        'Add a token with the `repo` scope (or fine-grained Actions: read) in GutterHub options.',
      );
    }

    const api = new GitHubApi(context.host, token);
    const runs = await api.workflowRuns(context.owner, context.repo, sha);

    if (runs.length === 0) {
      throw new CoverageResolutionError(
        `No workflow runs found for commit ${sha.slice(0, 7)}.`,
        'Coverage appears once CI has run for this commit.',
      );
    }

    const wantedWorkflow = source.workflowFile?.trim();
    const candidates = runs
      .filter(
        (run) =>
          !wantedWorkflow || run.html_url.includes(wantedWorkflow) || run.name === wantedWorkflow,
      )
      // Completed runs first, then newest, so an in-flight rerun does not hide a
      // finished run that already published its artifacts.
      .sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === 'completed' ? -1 : 1;
        }
        return Date.parse(b.created_at) - Date.parse(a.created_at);
      });

    const problems: string[] = [];

    for (const run of candidates) {
      const artifacts = await api.runArtifacts(context.owner, context.repo, run.id);
      const artifact = chooseArtifact(artifacts, source.artifactName);

      if (!artifact) {
        if (artifacts.length > 0) {
          problems.push(`${run.name}: ${artifacts.map((item) => item.name).join(', ')}`);
        }
        continue;
      }

      const archive = await api.downloadArtifact(context.owner, context.repo, artifact.id);
      const entry = readArchive(archive, source.entryName);

      return {
        text: entry.text,
        label: `${run.name} › ${artifact.name} › ${entry.name}`,
        fileName: entry.name,
      };
    }

    throw new CoverageResolutionError(
      `No artifact matching "${source.artifactName}" for commit ${sha.slice(0, 7)}.`,
      problems.length > 0 ? `Artifacts found: ${problems.join(' | ')}` : undefined,
    );
  },
};
