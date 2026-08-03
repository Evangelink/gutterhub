import { describe, expect, it } from 'vitest';
import { parseLocation, repositoryKey, samePage } from '../src/github/location.js';

describe('parseLocation', () => {
  it('recognises the pull request files tab', () => {
    expect(parseLocation('https://github.com/acme/widget/pull/42/files')).toEqual({
      kind: 'pull-request-files',
      host: 'github.com',
      owner: 'acme',
      repo: 'widget',
      pullNumber: 42,
    });
  });

  it('ignores the other pull request tabs', () => {
    // Only the diff has lines to annotate; running anywhere else is wasted work.
    expect(parseLocation('https://github.com/acme/widget/pull/42')).toBeNull();
    expect(parseLocation('https://github.com/acme/widget/pull/42/commits')).toBeNull();
    expect(parseLocation('https://github.com/acme/widget/pull/42/checks')).toBeNull();
  });

  it('keeps query strings and fragments out of the context', () => {
    expect(parseLocation('https://github.com/acme/widget/pull/42/files?diff=split#r1')).toEqual({
      kind: 'pull-request-files',
      host: 'github.com',
      owner: 'acme',
      repo: 'widget',
      pullNumber: 42,
    });
  });

  it('recognises a blob view and its path', () => {
    expect(parseLocation('https://github.com/acme/widget/blob/main/src/a/b.ts')).toEqual({
      kind: 'blob',
      host: 'github.com',
      owner: 'acme',
      repo: 'widget',
      ref: 'main',
      path: 'src/a/b.ts',
    });
  });

  it('decodes percent-escaped paths', () => {
    expect(parseLocation('https://github.com/acme/widget/blob/main/src/my%20file.ts')?.path).toBe(
      'src/my file.ts',
    );
  });

  it('recognises a commit view', () => {
    expect(parseLocation('https://github.com/acme/widget/commit/abc123')).toMatchObject({
      kind: 'commit',
      commitSha: 'abc123',
    });
  });

  it('works on GitHub Enterprise hosts', () => {
    expect(parseLocation('https://github.corp.net/acme/widget/pull/7/files')?.host).toBe(
      'github.corp.net',
    );
  });

  it.each([
    'https://github.com/',
    'https://github.com/acme',
    'https://github.com/acme/widget',
    'https://github.com/acme/widget/issues/3',
    'https://github.com/acme/widget/blob/main',
    'https://github.com/notifications',
    'https://github.com/settings/profile',
    'https://github.com/orgs/acme/repositories',
    'not a url',
  ])('returns null for %s', (url) => {
    expect(parseLocation(url)).toBeNull();
  });

  it('returns null for a pull request with a non-numeric id', () => {
    expect(parseLocation('https://github.com/acme/widget/pull/abc/files')).toBeNull();
  });
});

describe('repositoryKey', () => {
  it('joins owner and repository', () => {
    expect(repositoryKey({ host: 'github.com', owner: 'acme', repo: 'widget' })).toBe(
      'acme/widget',
    );
  });
});

describe('samePage', () => {
  const pull = parseLocation('https://github.com/acme/widget/pull/42/files');

  it('treats identical locations as the same page', () => {
    expect(samePage(pull, parseLocation('https://github.com/acme/widget/pull/42/files'))).toBe(
      true,
    );
  });

  it('distinguishes different pull requests', () => {
    expect(samePage(pull, parseLocation('https://github.com/acme/widget/pull/43/files'))).toBe(
      false,
    );
  });

  it('distinguishes different files in the same repository', () => {
    const a = parseLocation('https://github.com/acme/widget/blob/main/a.ts');
    const b = parseLocation('https://github.com/acme/widget/blob/main/b.ts');

    expect(samePage(a, b)).toBe(false);
  });

  it('treats two nulls as the same', () => {
    expect(samePage(null, null)).toBe(true);
  });

  it('treats null and a page as different', () => {
    expect(samePage(null, pull)).toBe(false);
  });
});
