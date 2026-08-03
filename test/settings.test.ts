import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE,
  normaliseRepositoryConfig,
  repositoryConfig,
  withRepositoryConfig,
  type CoverageSource,
  type GlobalSettings,
  type RepositoryConfig,
} from '../src/shared/settings.js';

function settings(...configs: RepositoryConfig[]): GlobalSettings {
  return {
    enabled: true,
    highlightLines: true,
    showPartial: true,
    githubToken: '',
    enterpriseHosts: [],
    repositories: Object.fromEntries(configs.map((config) => [config.key.toLowerCase(), config])),
  };
}

function config(key: string, sources: CoverageSource[], enabled = true): RepositoryConfig {
  return { key, enabled, sources, paths: {} };
}

const actions: CoverageSource = { kind: 'github-actions', artifactName: 'coverage*' };
const url: CoverageSource = { kind: 'url-template', template: 'https://ci/{owner}/{sha}.info' };
/**
 * A third, distinct source, so that the repository which must stay untouched never holds
 * the same value as the one being written. Without that, a cross-repository write would
 * be indistinguishable from correct behaviour.
 */
const manual: CoverageSource = { kind: 'manual' };

describe('per-repository configuration', () => {
  it('keeps a separate source per repository', () => {
    // The point of the whole design: a user reviewing several projects needs each one to
    // point at wherever *that* project publishes its reports.
    const all = settings(config('acme/widget', [actions]), config('other/thing', [url]));

    expect(repositoryConfig(all, 'acme/widget')?.sources).toEqual([actions]);
    expect(repositoryConfig(all, 'other/thing')?.sources).toEqual([url]);
  });

  it('does not disturb other repositories when one is updated', () => {
    // The untouched repository deliberately holds a source *different* from the one being
    // written. If both held the same value, an implementation that assigned the new config
    // to every repository would satisfy these assertions anyway.
    const before = settings(config('acme/widget', [actions]), config('other/thing', [manual]));

    const after = withRepositoryConfig(before, config('acme/widget', [url]));

    expect(repositoryConfig(after, 'acme/widget')?.sources).toEqual([url]);
    expect(repositoryConfig(after, 'other/thing')?.sources).toEqual([manual]);
    expect(Object.keys(after.repositories)).toHaveLength(2);
  });

  it('does not mutate the settings object it was given', () => {
    const before = settings(config('acme/widget', [actions]), config('other/thing', [manual]));

    withRepositoryConfig(before, config('acme/widget', [url]));

    expect(repositoryConfig(before, 'acme/widget')?.sources).toEqual([actions]);
    expect(repositoryConfig(before, 'other/thing')?.sources).toEqual([manual]);
  });

  it('adds a repository without touching the existing ones', () => {
    const before = settings(config('acme/widget', [actions]), config('other/thing', [manual]));

    const after = withRepositoryConfig(before, config('new/repo', [url]));

    expect(Object.keys(after.repositories).sort()).toEqual([
      'acme/widget',
      'new/repo',
      'other/thing',
    ]);
    expect(repositoryConfig(after, 'acme/widget')?.sources).toEqual([actions]);
    expect(repositoryConfig(after, 'other/thing')?.sources).toEqual([manual]);
  });

  it('looks a repository up regardless of the casing GitHub displays', () => {
    // GitHub preserves the owner's casing in URLs, so `Evangelink/GutterHub` and
    // `evangelink/gutterhub` are the same repository and must share one config.
    const all = settings(config('Evangelink/GutterHub', [actions]));

    expect(repositoryConfig(all, 'evangelink/gutterhub')).toBeDefined();
    expect(repositoryConfig(all, 'EVANGELINK/GUTTERHUB')).toBeDefined();
  });

  it('does not overwrite a repository when saved under different casing', () => {
    const before = settings(config('Evangelink/GutterHub', [actions]));

    const after = withRepositoryConfig(before, config('evangelink/gutterhub', [url]));

    expect(Object.keys(after.repositories)).toHaveLength(1);
    expect(repositoryConfig(after, 'Evangelink/GutterHub')?.sources).toEqual([url]);
  });

  it('returns nothing for a repository that was never configured', () => {
    expect(
      repositoryConfig(settings(config('acme/widget', [actions])), 'never/seen'),
    ).toBeUndefined();
  });

  it('keeps path mapping per repository', () => {
    // A monorepo may need a stripped prefix that would be wrong for anything else.
    const all = settings(
      {
        key: 'acme/mono',
        enabled: true,
        sources: [actions],
        paths: { stripPrefix: 'packages/app' },
      },
      { key: 'acme/plain', enabled: true, sources: [actions], paths: {} },
    );

    expect(repositoryConfig(all, 'acme/mono')?.paths.stripPrefix).toBe('packages/app');
    expect(repositoryConfig(all, 'acme/plain')?.paths.stripPrefix).toBeUndefined();
  });

  it('lets one repository be disabled while others stay on', () => {
    const all = settings(
      config('acme/noisy', [actions], false),
      config('acme/useful', [actions], true),
    );

    expect(repositoryConfig(all, 'acme/noisy')?.enabled).toBe(false);
    expect(repositoryConfig(all, 'acme/useful')?.enabled).toBe(true);
  });
});

describe('normaliseRepositoryConfig', () => {
  it('upgrades a config written before multiple sources existed', () => {
    // Read-time migration: a profile synced from an older install must keep working.
    const upgraded = normaliseRepositoryConfig({
      key: 'acme/widget',
      enabled: true,
      source: actions,
      paths: {},
    });

    expect(upgraded.sources).toEqual([actions]);
  });

  it('prefers the new shape when both are present', () => {
    const upgraded = normaliseRepositoryConfig({
      key: 'acme/widget',
      enabled: true,
      source: actions,
      sources: [url],
      paths: {},
    });

    expect(upgraded.sources).toEqual([url]);
  });

  it('falls back to the default source when a config has none', () => {
    const upgraded = normaliseRepositoryConfig({ key: 'acme/widget', enabled: true, paths: {} });

    expect(upgraded.sources).toEqual([DEFAULT_SOURCE]);
  });

  it('tolerates a config with no path options', () => {
    const upgraded = normaliseRepositoryConfig({
      key: 'acme/widget',
      enabled: true,
      sources: [actions],
    } as never);

    expect(upgraded.paths).toEqual({});
  });
});
