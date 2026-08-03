import { repositoryKey, type PageContext } from '../github/location.js';
import { CoverageResolutionError, GitHubApi, resolveCoverage } from '../providers/index.js';
import {
  isMessage,
  type ResolveCoverageRequest,
  type ResolveCoverageFailure,
  type ResolveCoverageResponse,
  type ResolvedReport,
} from '../shared/messages.js';
import {
  loadSettings,
  repositoryConfig,
  type CoverageSource,
  type RepositoryConfig,
} from '../shared/settings.js';

interface CacheEntry {
  text: string;
  label: string;
  fileName?: string;
  sha: string;
  storedAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 12;

/**
 * Reports are fetched here rather than in the content script so that requests are not
 * subject to github.com's page CORS policy, and so that every tab showing the same pull
 * request shares one download.
 */
const cache = new Map<string, CacheEntry>();

function cacheKey(
  context: PageContext,
  config: RepositoryConfig,
  source: CoverageSource,
  sha: string,
): string {
  return [
    context.host,
    repositoryKey(context),
    sha,
    JSON.stringify(source),
    JSON.stringify(config.paths),
  ].join('|');
}

function readCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry;
}

function writeCache(key: string, entry: CacheEntry): void {
  cache.set(key, entry);

  // Reports run to megabytes; an unbounded map would keep a service worker resident and
  // memory-hungry across a long review session.
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
}

/** A full commit SHA, as opposed to a branch, tag or abbreviated ref. */
const FULL_SHA = /^[0-9a-f]{40}$/i;

/**
 * Resolved refs, so that browsing several files on one branch costs one API call rather
 * than one per navigation. Unauthenticated users get 60 GitHub API calls an hour, which a
 * per-page lookup would burn through quickly.
 */
const refCache = new Map<string, { sha: string; storedAt: number }>();
const REF_CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveRef(context: PageContext, api: GitHubApi, ref: string): Promise<string> {
  if (FULL_SHA.test(ref)) {
    return ref;
  }

  const key = `${context.host}|${repositoryKey(context)}|${ref}`;
  const cached = refCache.get(key);
  if (cached && Date.now() - cached.storedAt < REF_CACHE_TTL_MS) {
    return cached.sha;
  }

  const sha = await api.commitSha(context.owner, context.repo, ref);
  refCache.set(key, { sha, storedAt: Date.now() });
  return sha;
}

/**
 * Whether any configured source actually needs a commit SHA.
 *
 * Resolving a branch ref costs a GitHub API call, and unauthenticated users get 60 an
 * hour. A hand-uploaded report needs no commit at all, and a URL template needs one only
 * if it interpolates it — so resolution is lazy rather than on every page load. Doing it
 * eagerly would also make an upload-only setup fail outright without a token.
 */
/** @internal Exported for testing. */
export function needsCommitSha(sources: readonly CoverageSource[]): boolean {
  return sources.some((source) => {
    switch (source.kind) {
      case 'github-actions':
      case 'azure-devops':
        return true;
      case 'url-template':
        return /\{(sha|shortSha)\}/.test(source.template);
      case 'manual':
        return false;
    }
  });
}

/**
 * Determines the commit whose reports should be shown.
 *
 * Everything artifact-based matches builds on a commit SHA, so a ref that is not already
 * one has to be resolved. A `/blob/main/...` URL carries the branch name, and passing
 * that through as if it were a commit makes those sources silently find nothing. The
 * branch is kept separately for URL templates that want it.
 */
async function resolveSha(
  context: PageContext,
  api: GitHubApi,
  sources: readonly CoverageSource[],
): Promise<{ sha: string; branch?: string }> {
  const resolve = async (ref: string): Promise<string> =>
    needsCommitSha(sources) ? resolveRef(context, api, ref) : ref;

  switch (context.kind) {
    case 'commit':
      // Commit URLs are usually full SHAs, but GitHub accepts abbreviated ones too.
      return { sha: await resolve(context.commitSha!) };

    case 'blob': {
      const ref = context.ref!;
      return FULL_SHA.test(ref) ? { sha: ref } : { sha: await resolve(ref), branch: ref };
    }

    case 'pull-request-files': {
      const pull = await api.pullRequest(context.owner, context.repo, context.pullNumber!);
      return pull.branch === undefined ? { sha: pull.sha } : { sha: pull.sha, branch: pull.branch };
    }
  }
}

async function handleResolve(request: ResolveCoverageRequest): Promise<ResolveCoverageResponse> {
  const settings = await loadSettings();

  if (!settings.enabled) {
    return { ok: false, reason: 'disabled', error: 'GutterHub is turned off.' };
  }

  const key = repositoryKey(request.context);
  const config = repositoryConfig(settings, key);

  if (!config) {
    return {
      ok: false,
      reason: 'not-configured',
      error: `No report source configured for ${key}.`,
      hint: 'Open the GutterHub popup to set one up.',
    };
  }

  if (!config.enabled) {
    return { ok: false, reason: 'disabled', error: `GutterHub is turned off for ${key}.` };
  }

  const api = new GitHubApi(request.context.host, settings.githubToken);

  try {
    const { sha, branch } = await resolveSha(request.context, api, config.sources);

    const reports: ResolvedReport[] = [];
    const warnings: string[] = [];
    const failures: ResolveCoverageFailure[] = [];

    for (const source of config.sources) {
      const entryKey = cacheKey(request.context, config, source, sha);

      if (!request.force) {
        const cached = readCache(entryKey);
        if (cached) {
          reports.push({
            text: cached.text,
            label: cached.label,
            cached: true,
            ...(cached.fileName ? { fileName: cached.fileName } : {}),
          });
          continue;
        }
      }

      try {
        const resolved = await resolveCoverage(source, {
          context: request.context,
          sha,
          token: settings.githubToken,
          azureToken: settings.azureToken,
          ...(branch ? { branch } : {}),
        });

        const entry: CacheEntry = {
          text: resolved.text,
          label: resolved.label,
          sha,
          storedAt: Date.now(),
          ...(resolved.fileName ? { fileName: resolved.fileName } : {}),
        };
        writeCache(entryKey, entry);

        reports.push({
          text: entry.text,
          label: entry.label,
          cached: false,
          ...(entry.fileName ? { fileName: entry.fileName } : {}),
        });
      } catch (error) {
        // Collected rather than rethrown: one broken source must not hide a working one.
        const failure = describeFailure(error);
        failures.push(failure);
        warnings.push(`${source.kind}: ${failure.error}`);
      }
    }

    if (reports.length === 0) {
      return failures[0] ?? { ok: false, reason: 'error', error: 'No sources configured.' };
    }

    return { ok: true, reports, sha, warnings };
  } catch (error) {
    return describeFailure(error);
  }
}

function describeFailure(error: unknown): ResolveCoverageFailure {
  if (error instanceof CoverageResolutionError) {
    return {
      ok: false,
      reason: 'error',
      error: error.message,
      ...(error.hint ? { hint: error.hint } : {}),
    };
  }

  return {
    ok: false,
    reason: 'error',
    error: error instanceof Error ? error.message : 'Unexpected failure.',
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isMessage(message, 'gutterhub:resolve')) {
    // Returning `true` keeps the channel open for the asynchronous reply.
    handleResolve(message).then(sendResponse, (error: unknown) =>
      sendResponse({
        ok: false,
        reason: 'error',
        error: error instanceof Error ? error.message : 'Unexpected failure.',
      } satisfies ResolveCoverageResponse),
    );
    return true;
  }

  if (isMessage(message, 'gutterhub:invalidate')) {
    cache.clear();
    refCache.clear();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Configuration changes can invalidate every cached report, and stale coverage is worse
// than none because it looks authoritative. The resolved-ref cache goes too, so a forced
// refresh genuinely re-reads the branch rather than reusing a commit that has moved on.
chrome.storage.onChanged.addListener(() => {
  cache.clear();
  refCache.clear();
});
