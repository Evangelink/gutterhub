import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { CoverageResolutionError, globMatch } from '../src/providers/types.js';
import { expandTemplate } from '../src/providers/urlTemplate.js';
import { chooseArtifact } from '../src/providers/githubActions.js';
import { readArchive } from '../src/providers/archive.js';
import type { WorkflowArtifact } from '../src/providers/githubApi.js';

const LCOV = 'SF:src/a.ts\nDA:1,1\nend_of_record\n';

/** Captures the error so both the message and the actionable hint can be asserted. */
function capture(action: () => unknown): CoverageResolutionError {
  try {
    action();
  } catch (error) {
    if (error instanceof CoverageResolutionError) {
      return error;
    }
    throw error;
  }

  throw new Error('Expected a CoverageResolutionError, but nothing was thrown.');
}

function artifact(name: string, overrides: Partial<WorkflowArtifact> = {}): WorkflowArtifact {
  return {
    id: name.length,
    name,
    expired: false,
    size_in_bytes: 1000,
    archive_download_url: `https://example.invalid/${name}`,
    ...overrides,
  };
}

describe('globMatch', () => {
  it.each([
    ['coverage*', 'coverage-net8.0', true],
    ['coverage*', 'coverage', true],
    ['*coverage*', 'my-coverage-report', true],
    ['coverage', 'coverage', true],
    ['COVERAGE*', 'coverage-x', true],
    ['coverage*', 'test-results', false],
    ['coverage', 'coverage-net8.0', false],
  ])('%s vs %s', (pattern, value, expected) => {
    expect(globMatch(pattern, value)).toBe(expected);
  });

  it('treats regex metacharacters as literals', () => {
    expect(globMatch('report.xml', 'reportAxml')).toBe(false);
    expect(globMatch('report.xml', 'report.xml')).toBe(true);
  });

  it('never matches on an empty pattern', () => {
    expect(globMatch('', 'anything')).toBe(false);
  });
});

describe('expandTemplate', () => {
  const values = {
    owner: 'acme',
    repo: 'widget',
    sha: '0123456789abcdef0123456789abcdef01234567',
    shortSha: '0123456',
    ref: 'main',
    branch: 'main',
    pr: '42',
    host: 'github.com',
    path: 'src/a.ts',
  };

  it('substitutes every placeholder', () => {
    expect(expandTemplate('https://x/{owner}/{repo}/{shortSha}/lcov.info', values)).toBe(
      'https://x/acme/widget/0123456/lcov.info',
    );
  });

  it('percent-encodes values so a branch with a slash cannot alter the path', () => {
    expect(expandTemplate('https://x/{branch}', { ...values, branch: 'feat/a b' })).toBe(
      'https://x/feat%2Fa%20b',
    );
  });

  it('leaves a template without placeholders untouched', () => {
    expect(expandTemplate('https://x/fixed.info', values)).toBe('https://x/fixed.info');
  });

  it('rejects an unknown placeholder instead of producing a broken URL', () => {
    // Leaving `{sha1}` in place would yield a 404 that is far harder to diagnose.
    expect(() => expandTemplate('https://x/{sha1}', values)).toThrow(/\{sha1\}/);
  });

  it('lists the available placeholders in the hint', () => {
    const error = capture(() => expandTemplate('https://x/{nope}', values));

    expect(error.message).toContain('{nope}');
    expect(error.hint).toContain('{shortSha}');
  });
});

describe('chooseArtifact', () => {
  it('matches by glob', () => {
    const chosen = chooseArtifact([artifact('logs'), artifact('coverage-net8.0')], 'coverage*');

    expect(chosen?.name).toBe('coverage-net8.0');
  });

  it('prefers the largest match, as the most complete report of a matrix build', () => {
    const chosen = chooseArtifact(
      [
        artifact('coverage-net8.0', { size_in_bytes: 100 }),
        artifact('coverage-net9.0', { size_in_bytes: 900 }),
      ],
      'coverage*',
    );

    expect(chosen?.name).toBe('coverage-net9.0');
  });

  it('ignores expired artifacts, which cannot be downloaded', () => {
    const chosen = chooseArtifact(
      [artifact('coverage-old', { expired: true, size_in_bytes: 9999 }), artifact('coverage-new')],
      'coverage*',
    );

    expect(chosen?.name).toBe('coverage-new');
  });

  it('falls back to a plausibly named artifact when the pattern misses', () => {
    const chosen = chooseArtifact([artifact('logs'), artifact('lcov-report')], 'nope*');

    expect(chosen?.name).toBe('lcov-report');
  });

  it('returns null when nothing looks like coverage', () => {
    expect(chooseArtifact([artifact('logs'), artifact('binaries')], 'coverage*')).toBeNull();
  });

  it('returns null for an empty artifact list', () => {
    expect(chooseArtifact([], 'coverage*')).toBeNull();
  });
});

describe('readArchive', () => {
  it('finds the coverage file among unrelated entries', () => {
    const zip = zipSync({
      'build.log': strToU8('lots of noise'),
      'lcov.info': strToU8(LCOV),
    });

    expect(readArchive(zip, undefined).name).toBe('lcov.info');
  });

  it('honours an explicit entry name', () => {
    const zip = zipSync({
      'lcov.info': strToU8(LCOV),
      'nested/other.info': strToU8('SF:z.ts\nDA:9,9\nend_of_record\n'),
    });

    const entry = readArchive(zip, 'nested/other.info');

    expect(entry.text).toContain('z.ts');
  });

  it('accepts a glob as the entry name', () => {
    const zip = zipSync({
      'reports/coverage.cobertura.xml': strToU8('<coverage><packages/></coverage>'),
    });

    expect(readArchive(zip, '*.cobertura.xml').name).toBe('reports/coverage.cobertura.xml');
  });

  it('detects a report whose name gives nothing away', () => {
    const zip = zipSync({ 'output.dat': strToU8(LCOV) });

    expect(readArchive(zip, undefined).text).toBe(LCOV);
  });

  it('reports what the archive held when the requested entry is absent', () => {
    const zip = zipSync({ 'lcov.info': strToU8(LCOV) });

    const error = capture(() => readArchive(zip, 'missing.xml'));

    expect(error.message).toContain('missing.xml');
    expect(error.hint).toContain('lcov.info');
  });

  it('rejects an archive with no report in it', () => {
    const zip = zipSync({ 'build.log': strToU8('nothing useful') });

    expect(() => readArchive(zip, undefined)).toThrow(/No recognisable report/);
  });

  it('rejects an empty archive', () => {
    expect(() => readArchive(zipSync({}), undefined)).toThrow(/empty/);
  });

  it('rejects a corrupt archive with a readable message', () => {
    expect(() => readArchive(new Uint8Array([1, 2, 3, 4]), undefined)).toThrow(
      /could not be read/i,
    );
  });
});
