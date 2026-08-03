import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApi } from '../src/providers/githubApi.js';
import { CoverageResolutionError } from '../src/providers/types.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

function mockFetch(handler: (url: string) => { status?: number; body?: unknown }) {
  const calls: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const { status = 200, body } = handler(url);
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => null },
        json: async () => body,
      } as unknown as Response;
    }),
  );

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHubApi.commitSha', () => {
  it('resolves a branch name to a commit SHA', () => {
    // A `/blob/main/...` URL carries the branch, but artifact-based sources match builds
    // on the commit, so the branch has to be turned into one first.
    mockFetch(() => ({ body: { sha: SHA } }));

    return expect(
      new GitHubApi('github.com', 't').commitSha('acme', 'widget', 'main'),
    ).resolves.toBe(SHA);
  });

  it('asks the commits endpoint for the ref', async () => {
    const calls = mockFetch(() => ({ body: { sha: SHA } }));

    await new GitHubApi('github.com', 't').commitSha('acme', 'widget', 'main');

    expect(calls[0]).toBe('https://api.github.com/repos/acme/widget/commits/main');
  });

  it('escapes a ref containing a slash', async () => {
    const calls = mockFetch(() => ({ body: { sha: SHA } }));

    await new GitHubApi('github.com', 't').commitSha('acme', 'widget', 'release/9.0');

    expect(calls[0]).toContain('release%2F9.0');
  });

  it('resolves an abbreviated commit SHA', () => {
    mockFetch(() => ({ body: { sha: SHA } }));

    return expect(
      new GitHubApi('github.com', 't').commitSha('acme', 'widget', '0123456'),
    ).resolves.toBe(SHA);
  });

  it('uses the Enterprise API base on a GitHub Enterprise host', async () => {
    const calls = mockFetch(() => ({ body: { sha: SHA } }));

    await new GitHubApi('github.corp.net', 't').commitSha('acme', 'widget', 'main');

    expect(calls[0]).toBe('https://github.corp.net/api/v3/repos/acme/widget/commits/main');
  });

  it('reports a ref that does not exist', async () => {
    mockFetch(() => ({ status: 404 }));

    await expect(
      new GitHubApi('github.com', 't').commitSha('acme', 'widget', 'nope'),
    ).rejects.toBeInstanceOf(CoverageResolutionError);
  });

  it('reports a response with no commit in it', async () => {
    mockFetch(() => ({ body: {} }));

    await expect(
      new GitHubApi('github.com', 't').commitSha('acme', 'widget', 'main'),
    ).rejects.toThrow(/Could not resolve "main"/);
  });
});
