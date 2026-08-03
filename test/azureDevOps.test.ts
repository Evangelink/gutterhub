import { describe, expect, it, vi, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { azureDevOpsProvider, chooseArtifact } from '../src/providers/azureDevOps.js';
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

function artifact(name: string) {
  return {
    name,
    resource: { downloadUrl: `https://artifacts.invalid/${name}.zip`, type: 'Container' },
  };
}

/** Routes each request by URL so a test can describe a whole conversation at once. */
function mockFetch(routes: {
  builds?: unknown;
  artifacts?: unknown;
  zip?: Uint8Array;
  status?: number;
}) {
  const calls: { url: string; headers: Record<string, string> }[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });

      if (routes.status && routes.status !== 200) {
        return { ok: false, status: routes.status } as Response;
      }
      if (url.includes('/artifacts?')) {
        return { ok: true, status: 200, json: async () => routes.artifacts } as Response;
      }
      if (url.includes('/build/builds?')) {
        return { ok: true, status: 200, json: async () => routes.builds } as Response;
      }
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => (routes.zip ?? new Uint8Array()).buffer,
      } as Response;
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

  it('requires an Azure DevOps token, and says it is not the GitHub one', async () => {
    const error = await failure(SOURCE, request({ azureToken: '' }));

    expect(error).toBeInstanceOf(CoverageResolutionError);
    expect(error.message).toMatch(/Azure DevOps token is required/);
    expect(error.hint).toMatch(/separate from the GitHub token/);
  });

  it('requires an organisation and project', async () => {
    await expect(
      azureDevOpsProvider.resolve({ ...SOURCE, organisation: '' }, request()),
    ).rejects.toThrow(/organisation and project are required/);
  });

  it('treats a 203 as an auth failure, which is what Azure DevOps actually returns', async () => {
    // An unauthenticated Azure DevOps API call answers with a sign-in page and HTTP 203,
    // not a 401, which is otherwise a baffling thing to debug.
    mockFetch({ status: 203 });

    const error = await failure(SOURCE, request());

    expect(error.message).toMatch(/Not authorised/);
    expect(error.hint).toMatch(/Build \(read\)/);
  });

  it('rejects a source meant for another provider', async () => {
    await expect(azureDevOpsProvider.resolve({ kind: 'manual' }, request())).rejects.toThrow(
      /Wrong provider/,
    );
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
