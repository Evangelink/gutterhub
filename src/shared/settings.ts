import type { PathMatchOptions } from '../core/pathMatch.js';

export type SourceKind = 'url-template' | 'github-actions' | 'manual';

export interface UrlTemplateSource {
  kind: 'url-template';
  /**
   * URL with `{owner}`, `{repo}`, `{sha}`, `{shortSha}`, `{ref}`, `{branch}` and `{pr}`
   * placeholders, e.g. `https://ci.example.com/{owner}/{repo}/{sha}/lcov.info`.
   */
  template: string;
}

export interface GitHubActionsSource {
  kind: 'github-actions';
  /** Glob-ish artifact name; `*` matches any run of characters. */
  artifactName: string;
  /** Optional file name inside the artifact archive. Empty means "first parseable file". */
  entryName?: string;
  /** Restrict the search to a single workflow file name, e.g. `ci.yml`. */
  workflowFile?: string;
}

export interface ManualSource {
  kind: 'manual';
}

export type CoverageSource = UrlTemplateSource | GitHubActionsSource | ManualSource;

export interface RepositoryConfig {
  /** `owner/repo`, lower-cased. */
  key: string;
  enabled: boolean;
  source: CoverageSource;
  paths: PathMatchOptions;
}

export interface GlobalSettings {
  /** Master switch, so the overlay can be silenced without losing configuration. */
  enabled: boolean;
  /** Show a tinted background across the whole line, not just the gutter mark. */
  highlightLines: boolean;
  /** Render partially covered lines in amber instead of treating them as covered. */
  showPartial: boolean;
  /** GitHub token used for the Actions artifact source and private repositories. */
  githubToken: string;
  /** Additional GitHub Enterprise hosts to run on. */
  enterpriseHosts: string[];
  repositories: Record<string, RepositoryConfig>;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  enabled: true,
  highlightLines: true,
  showPartial: true,
  githubToken: '',
  enterpriseHosts: [],
  repositories: {},
};

export const DEFAULT_SOURCE: CoverageSource = {
  kind: 'github-actions',
  artifactName: 'coverage*',
};

const STORAGE_KEY = 'gutterhub:settings';

function storageArea(): chrome.storage.StorageArea {
  // `sync` is capped at ~100KB and 8KB per item; coverage configuration is small, but
  // fall back to `local` when sync is unavailable (Firefox without a signed-in account).
  return chrome.storage.sync ?? chrome.storage.local;
}

export async function loadSettings(): Promise<GlobalSettings> {
  const stored = await storageArea().get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<GlobalSettings> | undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    // Spread does not deep-merge, and a partially written record would otherwise
    // replace the defaults wholesale.
    repositories: { ...(value?.repositories ?? {}) },
    enterpriseHosts: value?.enterpriseHosts ?? [],
  };
}

export async function saveSettings(settings: GlobalSettings): Promise<void> {
  await storageArea().set({ [STORAGE_KEY]: settings });
}

export function repositoryConfig(
  settings: GlobalSettings,
  key: string,
): RepositoryConfig | undefined {
  return settings.repositories[key.toLowerCase()];
}

export function withRepositoryConfig(
  settings: GlobalSettings,
  config: RepositoryConfig,
): GlobalSettings {
  return {
    ...settings,
    repositories: { ...settings.repositories, [config.key.toLowerCase()]: config },
  };
}

export function onSettingsChanged(listener: () => void): void {
  chrome.storage.onChanged.addListener((changes) => {
    if (STORAGE_KEY in changes) {
      listener();
    }
  });
}
