import { describe, expect, it, vi } from 'vitest';
import type { CoverageSource } from '../src/shared/settings.js';

// The background entry point registers chrome listeners on import, so the API has to
// exist before the module is loaded.
vi.stubGlobal('chrome', {
  runtime: { onMessage: { addListener: () => {} } },
  storage: { onChanged: { addListener: () => {} }, sync: null, local: null },
});

const { needsCommitSha } = await import('../src/background/index.js');

const actions: CoverageSource = { kind: 'github-actions', artifactName: 'coverage*' };
const azure: CoverageSource = {
  kind: 'azure-devops',
  organisation: 'org',
  project: 'proj',
  artifactName: 'coverage*',
};
const manual: CoverageSource = { kind: 'manual' };

function template(value: string): CoverageSource {
  return { kind: 'url-template', template: value };
}

describe('needsCommitSha', () => {
  it('is required by the GitHub Actions source', () => {
    expect(needsCommitSha([actions])).toBe(true);
  });

  it('is required by the Azure DevOps source', () => {
    // Azure matches builds on `sourceVersion`, which is always a commit.
    expect(needsCommitSha([azure])).toBe(true);
  });

  it('is not required by a hand-uploaded report', () => {
    // Resolving a ref costs an API call and needs a token for private repositories, so an
    // upload-only setup must not be made to depend on one.
    expect(needsCommitSha([manual])).toBe(false);
  });

  it.each([['{sha}'], ['{shortSha}']])('is required by a template using %s', (placeholder) => {
    expect(needsCommitSha([template(`https://ci/x/${placeholder}/lcov.info`)])).toBe(true);
  });

  it.each([['{branch}'], ['{pr}'], ['{owner}/{repo}']])(
    'is not required by a template using only %s',
    (placeholder) => {
      expect(needsCommitSha([template(`https://ci/${placeholder}/lcov.info`)])).toBe(false);
    },
  );

  it('is required when any one of several sources needs it', () => {
    expect(needsCommitSha([manual, azure])).toBe(true);
  });

  it('is not required when no source needs it', () => {
    expect(needsCommitSha([manual, template('https://ci/{branch}.info')])).toBe(false);
  });

  it('is not required when nothing is configured', () => {
    expect(needsCommitSha([])).toBe(false);
  });
});
