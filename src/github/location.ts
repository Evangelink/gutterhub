/**
 * Identifies where GutterHub is running and what it should paint.
 */

export type PageKind = 'pull-request-files' | 'blob' | 'commit';

export interface RepositoryRef {
  host: string;
  owner: string;
  repo: string;
}

export interface PageContext extends RepositoryRef {
  kind: PageKind;
  /** Pull request number, for `pull-request-files`. */
  pullNumber?: number;
  /** Commit SHA, for `commit`. */
  commitSha?: string;
  /** Branch, tag or SHA taken from a blob URL. */
  ref?: string;
  /** Repository-relative file path, for `blob`. */
  path?: string;
}

/** `owner/repo`, the key used for per-repository settings. */
export function repositoryKey(ref: RepositoryRef): string {
  return `${ref.owner}/${ref.repo}`;
}

const RESERVED_OWNERS = new Set([
  'about',
  'apps',
  'collections',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

/**
 * Derives the page context from a GitHub URL.
 *
 * Returns `null` for any page GutterHub has nothing to say about, which keeps the
 * content script inert on the vast majority of GitHub navigations.
 */
export function parseLocation(url: string): PageContext | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  const [owner, repo, section, ...rest] = segments;

  if (!owner || !repo || RESERVED_OWNERS.has(owner.toLowerCase())) {
    return null;
  }

  const base: RepositoryRef = { host: parsed.host, owner, repo };

  if (section === 'pull') {
    const pullNumber = Number.parseInt(rest[0] ?? '', 10);
    if (Number.isNaN(pullNumber)) {
      return null;
    }
    // Only the "Files changed" tab has a diff to annotate. The conversation and
    // commits tabs are deliberately skipped.
    if (rest[1] !== 'files' && rest[1] !== 'changes') {
      return null;
    }
    return { ...base, kind: 'pull-request-files', pullNumber };
  }

  if (section === 'blob') {
    const ref = rest[0];
    const path = rest.slice(1).join('/');
    if (!ref || path.length === 0) {
      return null;
    }
    return { ...base, kind: 'blob', ref, path: decodeURIComponent(path) };
  }

  if (section === 'commit') {
    const commitSha = rest[0];
    if (!commitSha) {
      return null;
    }
    return { ...base, kind: 'commit', commitSha };
  }

  return null;
}

export function samePage(a: PageContext | null, b: PageContext | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return (
    a.kind === b.kind &&
    a.host === b.host &&
    a.owner === b.owner &&
    a.repo === b.repo &&
    a.pullNumber === b.pullNumber &&
    a.commitSha === b.commitSha &&
    a.ref === b.ref &&
    a.path === b.path
  );
}
