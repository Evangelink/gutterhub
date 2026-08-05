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
  /**
   * Distinguishes several hand-uploaded reports for one repository, so that a coverage
   * report and a mutation report can be held at the same time without colliding.
   */
  slot?: string;
}

export interface AzureDevOpsSource {
  kind: 'azure-devops';
  /** The organisation in `https://dev.azure.com/{organisation}`. */
  organisation: string;
  project: string;
  /** Glob-ish artifact name; `*` matches any run of characters. */
  artifactName: string;
  /** Optional file name inside the artifact archive. Empty means "first parseable file". */
  entryName?: string;
  /** Restrict the search to one pipeline, by numeric definition id. */
  definitionId?: string;
}

export type CoverageSource =
  UrlTemplateSource | GitHubActionsSource | ManualSource | AzureDevOpsSource;

export interface RepositoryConfig {
  /** `owner/repo`, lower-cased. */
  key: string;
  enabled: boolean;
  /**
   * Reports to overlay, drawn as separate channels in the gutter. More than one is the
   * interesting case: coverage and mutation testing disagreeing on a line is precisely
   * the code that looks tested and is not.
   */
  sources: CoverageSource[];
  paths: PathMatchOptions;
}

/** Shape of a config written before multiple sources were supported. */
interface LegacyRepositoryConfig extends Omit<RepositoryConfig, 'sources'> {
  source?: CoverageSource;
  sources?: CoverageSource[];
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
  /**
   * Optional Azure DevOps token for private projects, used only by the Azure DevOps source.
   * Deliberately separate from the GitHub one: they are different credentials for different
   * services, and sending either to the other would be both broken and a leak.
   */
  azureToken: string;
  /** Additional GitHub Enterprise hosts to run on. */
  enterpriseHosts: string[];
  repositories: Record<string, RepositoryConfig>;
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  enabled: true,
  highlightLines: true,
  showPartial: true,
  githubToken: '',
  azureToken: '',
  enterpriseHosts: [],
  repositories: {},
};

export const DEFAULT_SOURCE: CoverageSource = {
  kind: 'github-actions',
  artifactName: 'coverage*',
};

const STORAGE_KEY = 'gutterhub:settings';

function storageArea(): chrome.storage.StorageArea {
  // `sync` is capped at ~100KB and 8KB per item; configuration is small, but fall back
  // to `local` when sync is unavailable (Firefox without a signed-in account).
  return chrome.storage.sync ?? chrome.storage.local;
}

/**
 * Reads a stored repository config, upgrading the single-`source` shape written before
 * multiple reports were supported. Migrating on read rather than with a one-off rewrite
 * means a profile synced from an older install keeps working without a migration step
 * that has to be remembered forever.
 */
export function normaliseRepositoryConfig(stored: LegacyRepositoryConfig): RepositoryConfig {
  const sources = stored.sources ?? (stored.source ? [stored.source] : []);

  return {
    key: stored.key,
    enabled: stored.enabled,
    sources: sources.length > 0 ? sources : [DEFAULT_SOURCE],
    paths: stored.paths ?? {},
  };
}

export async function loadSettings(): Promise<GlobalSettings> {
  const stored = await storageArea().get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<GlobalSettings> | undefined;

  const repositories: Record<string, RepositoryConfig> = {};
  for (const [key, config] of Object.entries(value?.repositories ?? {})) {
    repositories[key] = normaliseRepositoryConfig(config as unknown as LegacyRepositoryConfig);
  }

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    // Spread does not deep-merge, and a partially written record would otherwise
    // replace the defaults wholesale.
    repositories,
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
