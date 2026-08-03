import {
  loadSettings,
  saveSettings,
  type CoverageSource,
  type GlobalSettings,
  type RepositoryConfig,
} from '../shared/settings.js';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing element #${id}`);
  }
  return found as T;
}

const ui = {
  enabled: element<HTMLInputElement>('enabled'),
  highlightLines: element<HTMLInputElement>('highlight-lines'),
  showPartial: element<HTMLInputElement>('show-partial'),
  token: element<HTMLInputElement>('token'),
  azureToken: element<HTMLInputElement>('azure-token'),
  enterpriseHosts: element<HTMLInputElement>('enterprise-hosts'),
  repoList: element('repo-list'),
  repoEmpty: element('repo-empty'),
  pathRepo: element<HTMLSelectElement>('path-repo'),
  stripPrefix: element<HTMLInputElement>('strip-prefix'),
  addPrefix: element<HTMLInputElement>('add-prefix'),
  ignoreCase: element<HTMLInputElement>('ignore-case'),
  save: element<HTMLButtonElement>('save'),
  saved: element('saved'),
};

let settings: GlobalSettings;

function describeOneSource(source: CoverageSource): string {
  switch (source.kind) {
    case 'github-actions':
      return `Actions artifact “${source.artifactName}”`;
    case 'azure-devops':
      return `Azure DevOps ${source.organisation}/${source.project} › “${source.artifactName}”`;
    case 'url-template':
      return source.template || 'URL (not set)';
    case 'manual':
      return source.slot ? `Uploaded by hand (${source.slot})` : 'Uploaded by hand';
  }
}

function describeSource(config: RepositoryConfig): string {
  return config.sources.map(describeOneSource).join(' + ') || 'No source configured';
}

function renderRepositories(): void {
  const configs = Object.values(settings.repositories);
  ui.repoList.replaceChildren();
  ui.repoEmpty.hidden = configs.length > 0;

  const previous = ui.pathRepo.value;
  ui.pathRepo.replaceChildren();

  for (const config of configs.sort((a, b) => a.key.localeCompare(b.key))) {
    const row = document.createElement('div');
    row.className = 'repo-row';

    const label = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = config.key;
    const detail = document.createElement('div');
    detail.className = 'hint';
    detail.textContent = describeSource(config);
    label.append(name, detail);

    const actions = document.createElement('div');
    actions.className = 'row';

    const toggle = document.createElement('label');
    toggle.className = 'inline';
    toggle.style.margin = '0';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = config.enabled;
    checkbox.addEventListener('change', () => {
      config.enabled = checkbox.checked;
    });
    toggle.append(checkbox, document.createTextNode('Enabled'));

    const remove = document.createElement('button');
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      delete settings.repositories[config.key.toLowerCase()];
      renderRepositories();
    });

    actions.append(toggle, remove);
    row.append(label, actions);
    ui.repoList.append(row);

    const option = document.createElement('option');
    option.value = config.key.toLowerCase();
    option.textContent = config.key;
    ui.pathRepo.append(option);
  }

  if (previous && configs.some((config) => config.key.toLowerCase() === previous)) {
    ui.pathRepo.value = previous;
  }

  renderPaths();
}

function renderPaths(): void {
  const config = settings.repositories[ui.pathRepo.value];
  ui.stripPrefix.value = config?.paths.stripPrefix ?? '';
  ui.addPrefix.value = config?.paths.addPrefix ?? '';
  ui.ignoreCase.checked = config?.paths.ignoreCase ?? false;

  const disabled = config === undefined;
  ui.stripPrefix.disabled = disabled;
  ui.addPrefix.disabled = disabled;
  ui.ignoreCase.disabled = disabled;
}

function capturePaths(): void {
  const config = settings.repositories[ui.pathRepo.value];
  if (!config) {
    return;
  }

  config.paths = {
    ...(ui.stripPrefix.value.trim() ? { stripPrefix: ui.stripPrefix.value.trim() } : {}),
    ...(ui.addPrefix.value.trim() ? { addPrefix: ui.addPrefix.value.trim() } : {}),
    ...(ui.ignoreCase.checked ? { ignoreCase: true } : {}),
  };
}

function parseHosts(value: string): string[] {
  return value
    .split(',')
    .map((host) =>
      host
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, ''),
    )
    .filter((host) => host.length > 0);
}

/**
 * Enterprise hosts are not in the manifest's `host_permissions`, so the user has to grant
 * them explicitly. Asking here — during an explicit save — keeps the prompt tied to a
 * deliberate action rather than surprising them mid-review.
 */
async function requestHostAccess(hosts: readonly string[]): Promise<void> {
  if (hosts.length === 0) {
    return;
  }

  const origins = hosts.map((host) => `https://${host}/*`);
  const granted = await chrome.permissions.contains({ origins });
  if (granted) {
    return;
  }

  await chrome.permissions.request({ origins });
}

async function initialise(): Promise<void> {
  settings = await loadSettings();

  ui.enabled.checked = settings.enabled;
  ui.highlightLines.checked = settings.highlightLines;
  ui.showPartial.checked = settings.showPartial;
  ui.token.value = settings.githubToken;
  ui.azureToken.value = settings.azureToken;
  ui.enterpriseHosts.value = settings.enterpriseHosts.join(', ');

  renderRepositories();
}

ui.pathRepo.addEventListener('change', renderPaths);
for (const input of [ui.stripPrefix, ui.addPrefix, ui.ignoreCase]) {
  input.addEventListener('change', capturePaths);
}

ui.save.addEventListener('click', async () => {
  ui.save.disabled = true;
  capturePaths();

  try {
    const hosts = parseHosts(ui.enterpriseHosts.value);
    await requestHostAccess(hosts);

    await saveSettings({
      ...settings,
      enabled: ui.enabled.checked,
      highlightLines: ui.highlightLines.checked,
      showPartial: ui.showPartial.checked,
      githubToken: ui.token.value.trim(),
      azureToken: ui.azureToken.value.trim(),
      enterpriseHosts: hosts,
    });

    ui.saved.textContent = 'Saved.';
    setTimeout(() => {
      ui.saved.textContent = '';
    }, 2000);
  } catch (error) {
    ui.saved.textContent = error instanceof Error ? error.message : 'Could not save.';
  } finally {
    ui.save.disabled = false;
  }
});

void initialise();
