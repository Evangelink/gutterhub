import { describe, expect, it, vi, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import {
  AZURE_ORIGINS,
  azureDevOpsProvider,
  buildCommits,
  chooseArtifact,
} from '../src/providers/azureDevOps.js';
import { CoverageResolutionError } from '../src/providers/types.js';
import { parseLocation } from '../src/github/location.js';
import type { CoverageSource } from '../src/shared/settings.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const CONTEXT = parseLocation('https://github.com/acme/widget/pull/42/files')!;

const SOURCE: CoverageSource = {
  kind: 'azure-devops',
  organisation: 'my-org',
  project: 'my-project',
  artifactName: 'coverage*',
};

const LCOV = 'SF:src/a.ts\nDA:1,1\nend_of_record\n';

function request(overrides: Partial<Parameters<typeof azureDevOpsProvider.resolve>[1]> = {}) {
  return { context: CONTEXT, sha: SHA, token: 'gh-token', azureToken: 'azdo-token', ...overrides };
}

/** Runs a resolve that is expected to fail, and returns the error for inspection. */
async function failure(
  source: CoverageSource,
  req: ReturnType<typeof request>,
): Promise<CoverageResolutionError> {
  try {
    await azureDevOpsProvider.resolve(source, req);
  } catch (caught) {
    return caught as CoverageResolutionError;
  }
  throw new Error('Expected the resolve to fail, but it succeeded.');
}
function build(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    buildNumber: '20260803.1',
    status: 'completed',
    result: 'succeeded',
    sourceVersion: SHA,
    definition: { name: 'CI' },
    ...overrides,
  };
}

/**
 * A pull request validation build: Azure records the synthetic merge commit in
 * `sourceVersion`, and the head GitHub shows on the PR page in `triggerInfo`.
 */
function prBuild(headSha: string, overrides: Record<string, unknown> = {}) {
  return build({
    sourceVersion: 'ffffffffffffffffffffffffffffffffffffffff',
    sourceBranch: 'refs/pull/42/merge',
    triggerInfo: { 'pr.sourceSha': headSha, 'pr.number': '42' },
    ...overrides,
  });
}

function artifact(name: string) {
  return {
    name,
    resource: { downloadUrl: `https://artifacts.invalid/${name}.zip`, type: 'Container' },
  };
}

/**
 * Routes each request by URL so a test can describe a whole conversation at once.
 *
 * `ok` is derived from the status exactly as fetch defines it — any 2xx — rather than
 * "is it 200". Getting that wrong is what let a 203 sign-in response look like a failure
 * in tests while sailing straight through in the browser.
 */
function mockFetch(routes: {
  builds?: unknown;
  artifacts?: unknown;
  zip?: Uint8Array;
  status?: number;
  html?: string;
}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const status = routes.status ?? 200;
  const ok = status >= 200 && status < 300;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });

      return {
        ok,
        status,
        // An Azure DevOps sign-in page is HTML, so parsing it as JSON throws — exactly
        // what production hits if a 203 is mistaken for success.
        json: async () => {
          if (routes.html !== undefined) {
            throw new SyntaxError('Unexpected token < in JSON');
          }
          return url.includes('/artifacts?') ? routes.artifacts : routes.builds;
        },
        arrayBuffer: async () =>
          routes.html !== undefined
            ? strToU8(routes.html).buffer
            : (routes.zip ?? new Uint8Array()).buffer,
      } as unknown as Response;
    }),
  );

  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('azureDevOpsProvider', () => {
  it('resolves a report from the build matching the commit', async () => {
    mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage-results')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    const resolved = await azureDevOpsProvider.resolve(SOURCE, request());

    expect(resolved.text).toBe(LCOV);
    expect(resolved.fileName).toBe('lcov.info');
  });

  it('labels the report with the pipeline, build, artifact and entry', async () => {
    mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage-results')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    const resolved = await azureDevOpsProvider.resolve(SOURCE, request());

    expect(resolved.label).toContain('CI');
    expect(resolved.label).toContain('20260803.1');
    expect(resolved.label).toContain('coverage-results');
  });

  it('authenticates with basic auth and an empty username', async () => {
    // Azure DevOps takes the PAT as the *password*; sending it as a bearer token fails.
    const calls = mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await azureDevOpsProvider.resolve(SOURCE, request());

    expect(calls[0]!.headers['Authorization']).toBe(`Basic ${btoa(':azdo-token')}`);
  });

  it('reads public projects anonymously when no Azure DevOps token is configured', async () => {
    const calls = mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await expect(
      azureDevOpsProvider.resolve(SOURCE, request({ azureToken: '' })),
    ).resolves.toBeDefined();

    for (const call of calls) {
      expect(call.headers).not.toHaveProperty('Authorization');
    }
  });

  it('never sends the GitHub token to Azure DevOps', async () => {
    const calls = mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await azureDevOpsProvider.resolve(SOURCE, request());

    for (const call of calls) {
      expect(JSON.stringify(call.headers)).not.toContain('gh-token');
    }
  });

  it('filters builds to the repository being viewed', async () => {
    const calls = mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await azureDevOpsProvider.resolve(SOURCE, request());

    expect(calls[0]!.url).toContain('repositoryType=GitHub');
    expect(calls[0]!.url).toContain('repositoryId=acme%2Fwidget');
  });

  it('matches the commit client-side, since the API cannot filter on it', async () => {
    mockFetch({
      builds: { value: [build({ id: 1, sourceVersion: 'other' }), build({ id: 2 })] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    const resolved = await azureDevOpsProvider.resolve(SOURCE, request());

    expect(resolved.text).toBe(LCOV);
  });

  it('prefers a completed build over one still running', async () => {
    const calls = mockFetch({
      builds: {
        value: [build({ id: 9, status: 'inProgress' }), build({ id: 8, status: 'completed' })],
      },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await azureDevOpsProvider.resolve(SOURCE, request());

    expect(calls[1]!.url).toContain('/builds/8/artifacts');
  });

  it('scopes to one pipeline when a definition id is set', async () => {
    const calls = mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await azureDevOpsProvider.resolve({ ...SOURCE, definitionId: '77' }, request());

    expect(calls[0]!.url).toContain('definitions=77');
  });

  it('explains that no build ran for the commit', async () => {
    mockFetch({ builds: { value: [build({ sourceVersion: 'different' })] } });

    await expect(azureDevOpsProvider.resolve(SOURCE, request())).rejects.toThrow(
      /No Azure DevOps build found/,
    );
  });

  it('says so when the repository has no builds at all', async () => {
    mockFetch({ builds: { value: [] } });

    const error = await failure(SOURCE, request());

    expect(error.message).toMatch(/No Azure DevOps build found/);
    expect(error.hint).toMatch(/No builds at all/);
  });

  it('lists the artifacts that were there when none match', async () => {
    mockFetch({ builds: { value: [build()] }, artifacts: { value: [artifact('logs')] } });

    const error = await failure(SOURCE, request());

    expect(error.message).toMatch(/No artifact matching/);
    expect(error.hint).toContain('logs');
  });

  it('requires an organisation and project', async () => {
    await expect(
      azureDevOpsProvider.resolve({ ...SOURCE, organisation: '' }, request()),
    ).rejects.toThrow(/organisation and project are required/);
  });

  it('treats a 203 as an auth failure, which is what Azure DevOps actually returns', async () => {
    // Fetch defines *any* 2xx as `ok`, and an unauthenticated Azure DevOps call answers
    // 203 with an HTML sign-in page rather than 401. Relying on `ok` alone sails past the
    // auth failure and then throws a JSON parse error, which tells the user nothing.
    mockFetch({ status: 203, html: '<html>Sign in to Azure DevOps</html>' });

    const error = await failure(SOURCE, request({ azureToken: '' }));

    expect(error).toBeInstanceOf(CoverageResolutionError);
    expect(error.message).toMatch(/Not authorised/);
    expect(error.hint).toMatch(/Public projects need no token/);
    expect(error.hint).toMatch(/Build \(read\)/);
  });

  it('treats a 203 on the artifact download as an auth failure too', async () => {
    // The download path is a separate fetch and needs the same guard; without it the
    // sign-in page reaches the unzipper and is reported as a corrupt archive.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const isApi = url.includes('/_apis/');
        return {
          ok: true,
          status: isApi ? 200 : 203,
          json: async () =>
            url.includes('/artifacts?') ? { value: [artifact('coverage')] } : { value: [build()] },
          arrayBuffer: async () => strToU8('<html>Sign in</html>').buffer,
        } as unknown as Response;
      }),
    );

    const error = await failure(SOURCE, request());

    expect(error.message).toMatch(/Not authorised/);
    expect(error.message).not.toMatch(/could not be read/i);
  });

  it('tries the next matching build when the newest has no usable artifact', async () => {
    // Several pipelines can build one commit and only some publish coverage. Stopping at
    // the most recent would report a false failure whenever an unrelated one finished last.
    let artifactCall = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/artifacts?')) {
          artifactCall++;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              value: artifactCall === 1 ? [artifact('logs')] : [artifact('coverage')],
            }),
          } as unknown as Response;
        }
        if (url.includes('/build/builds?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ value: [build({ id: 20 }), build({ id: 10 })] }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => zipSync({ 'lcov.info': strToU8(LCOV) }).buffer,
        } as unknown as Response;
      }),
    );

    const resolved = await azureDevOpsProvider.resolve(SOURCE, request());

    expect(artifactCall).toBe(2);
    expect(resolved.text).toBe(LCOV);
  });

  it('rejects a source meant for another provider', async () => {
    await expect(azureDevOpsProvider.resolve({ kind: 'manual' }, request())).rejects.toThrow(
      /Wrong provider/,
    );
  });
});

describe('pull request validation builds', () => {
  it('matches a PR build on its head commit, not the merge commit', async () => {
    // Azure records the synthetic merge commit in `sourceVersion`, while the GitHub PR
    // page — and so `resolveSha` — reports the head of the PR branch. Matching only
    // `sourceVersion` therefore misses every PR build, which is the case this provider
    // most needs to serve.
    mockFetch({
      builds: { value: [prBuild(SHA)] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    const resolved = await azureDevOpsProvider.resolve(SOURCE, request());

    expect(resolved.text).toBe(LCOV);
  });

  it('still matches an ordinary build on its source version', async () => {
    mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await expect(azureDevOpsProvider.resolve(SOURCE, request())).resolves.toBeDefined();
  });

  it('does not match a PR build for a different commit', async () => {
    mockFetch({ builds: { value: [prBuild('a'.repeat(40))] } });

    await expect(azureDevOpsProvider.resolve(SOURCE, request())).rejects.toThrow(
      /No Azure DevOps build found/,
    );
  });

  it('reports both candidate commits for a build', () => {
    expect(buildCommits(prBuild(SHA))).toEqual(['ffffffffffffffffffffffffffffffffffffffff', SHA]);
  });

  it('reports just the source version when there is no trigger info', () => {
    expect(buildCommits(build())).toEqual([SHA]);
  });

  it('ignores trigger info that carries no head commit', () => {
    expect(buildCommits(build({ triggerInfo: { 'pr.number': '42' } }))).toEqual([SHA]);
  });
});

describe('artifact download permissions', () => {
  /** Stubs `chrome.permissions.contains` the way MV3 would answer. */
  function stubPermissions(granted: boolean) {
    vi.stubGlobal('chrome', { permissions: { contains: async () => granted } });
  }

  it('explains a missing host permission instead of failing opaquely', async () => {
    // Artifacts are served from regional hosts rather than dev.azure.com, so a fetch to
    // an ungranted origin fails at the MV3 host-permission boundary with nothing useful.
    stubPermissions(false);
    mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    const error = await failure(SOURCE, request());

    expect(error.message).toMatch(/not allowed to download/);
    expect(error.hint).toMatch(/press Save/i);
  });

  it('proceeds when the origin has been granted', async () => {
    stubPermissions(true);
    mockFetch({
      builds: { value: [build()] },
      artifacts: { value: [artifact('coverage')] },
      zip: zipSync({ 'lcov.info': strToU8(LCOV) }),
    });

    await expect(azureDevOpsProvider.resolve(SOURCE, request())).resolves.toBeDefined();
  });

  it('covers the API host and the regional artifact hosts', () => {
    expect(AZURE_ORIGINS).toContain('https://dev.azure.com/*');
    expect(AZURE_ORIGINS).toContain('https://*.artifacts.visualstudio.com/*');
  });
});

describe('chooseArtifact', () => {
  it('matches by glob', () => {
    expect(chooseArtifact([artifact('logs'), artifact('coverage-net8')], 'coverage*')?.name).toBe(
      'coverage-net8',
    );
  });

  it('falls back to a plausibly named artifact', () => {
    expect(chooseArtifact([artifact('logs'), artifact('mutation-report')], 'nope*')?.name).toBe(
      'mutation-report',
    );
  });

  it('ignores artifacts with no download url', () => {
    expect(chooseArtifact([{ name: 'coverage', resource: {} }], 'coverage*')).toBeNull();
  });

  it('returns null when nothing looks like a report', () => {
    expect(chooseArtifact([artifact('logs')], 'coverage*')).toBeNull();
  });
});
