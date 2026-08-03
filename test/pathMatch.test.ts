import { describe, expect, it } from 'vitest';
import { PathIndex, commonSuffixSegments, normalisePath } from '../src/core/pathMatch.js';
import type { FileCoverage } from '../src/core/model.js';

function file(path: string): FileCoverage {
  return { path, lines: new Map([[1, { line: 1, hits: 1 }]]) };
}

describe('normalisePath', () => {
  it.each([
    ['src\\a\\b.cs', 'src/a/b.cs'],
    ['./src/a.ts', 'src/a.ts'],
    ['/home/runner/work/repo/src/a.ts', 'home/runner/work/repo/src/a.ts'],
    ['D:/a/1/s/src/a.cs', 'a/1/s/src/a.cs'],
    ['D:\\a\\1\\s\\src\\a.cs', 'a/1/s/src/a.cs'],
    ['file:///D:/work/src/a.ts', 'work/src/a.ts'],
    ['src//a///b.ts', 'src/a/b.ts'],
    ['src/x/../a.ts', 'src/a.ts'],
    ['  src/a.ts  ', 'src/a.ts'],
  ])('normalises %j to %j', (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });

  it('returns an empty string for a path with no usable segments', () => {
    expect(normalisePath('/')).toBe('');
  });
});

describe('commonSuffixSegments', () => {
  it('counts whole matching segments from the end', () => {
    expect(commonSuffixSegments(['a', 'b', 'c'], ['x', 'b', 'c'])).toBe(2);
  });

  it('returns zero when the file names differ', () => {
    expect(commonSuffixSegments(['a', 'b'], ['a', 'c'])).toBe(0);
  });

  it('does not match partial segments', () => {
    expect(commonSuffixSegments(['src', 'foo.ts'], ['src', 'barfoo.ts'])).toBe(0);
  });
});

describe('PathIndex', () => {
  it('matches an absolute CI path against a repository-relative path', () => {
    const index = new PathIndex([file('/home/runner/work/repo/repo/src/app.ts')]);

    expect(index.lookup('src/app.ts')?.path).toBe('/home/runner/work/repo/repo/src/app.ts');
  });

  it('matches a Windows agent path', () => {
    const index = new PathIndex([file('D:\\a\\1\\s\\src\\Calc.cs')]);

    expect(index.lookup('src/Calc.cs')).not.toBeNull();
  });

  it('matches when the coverage path is shorter than the repository path', () => {
    const index = new PathIndex([file('Calc.cs')]);

    expect(index.lookup('src/deep/Calc.cs')).not.toBeNull();
  });

  it('returns null for a file the report does not mention', () => {
    const index = new PathIndex([file('src/app.ts')]);

    expect(index.lookup('src/other.ts')).toBeNull();
  });

  it('rejects a same-named file living under a different directory', () => {
    // `a/b/Foo.cs` and `x/b/Foo.cs` share two trailing segments but neither path is
    // fully consumed, so painting one with the other's coverage would be wrong.
    const index = new PathIndex([file('a/b/Foo.cs')]);

    expect(index.lookup('x/b/Foo.cs')).toBeNull();
  });

  it('prefers the longest matching suffix when several candidates share a name', () => {
    const index = new PathIndex([file('Utils.cs'), file('src/core/Utils.cs')]);

    expect(index.lookup('src/core/Utils.cs')?.path).toBe('src/core/Utils.cs');
  });

  it('flags an ambiguous match between indistinguishable candidates', () => {
    const index = new PathIndex([file('one/Utils.cs'), file('two/Utils.cs')]);

    expect(index.match('Utils.cs')?.ambiguous).toBe(true);
  });

  it('does not flag a single clear winner as ambiguous', () => {
    const index = new PathIndex([file('src/core/Utils.cs'), file('Other.cs')]);

    expect(index.match('src/core/Utils.cs')?.ambiguous).toBe(false);
  });

  it('reports the number of matched segments', () => {
    const index = new PathIndex([file('/build/src/core/Utils.cs')]);

    expect(index.match('src/core/Utils.cs')?.score).toBe(3);
  });

  it('strips a configured prefix from coverage paths', () => {
    const index = new PathIndex([file('packages/app/src/main.ts')], {
      stripPrefix: 'packages/app',
    });

    expect(index.lookup('src/main.ts')).not.toBeNull();
  });

  it('adds a configured prefix to coverage paths', () => {
    const index = new PathIndex([file('src/main.ts')], { addPrefix: 'packages/app' });

    expect(index.match('packages/app/src/main.ts')?.score).toBe(4);
  });

  it('matches case-insensitively when asked', () => {
    const index = new PathIndex([file('SRC/App.TS')], { ignoreCase: true });

    expect(index.lookup('src/app.ts')).not.toBeNull();
  });

  it('still resolves a case-mismatched file name without the option', () => {
    const index = new PathIndex([file('src/App.cs')]);

    expect(index.lookup('src/app.cs')).not.toBeNull();
  });

  it('exposes how many files were indexed', () => {
    expect(new PathIndex([file('a.ts'), file('b/a.ts')]).size).toBe(2);
  });

  it('drops entries that become empty after stripping', () => {
    const index = new PathIndex([file('packages/app')], { stripPrefix: 'packages/app' });

    expect(index.size).toBe(0);
  });

  it('returns null for an empty lookup path', () => {
    expect(new PathIndex([file('a.ts')]).lookup('')).toBeNull();
  });
});
