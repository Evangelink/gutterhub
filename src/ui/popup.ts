import { PRESENTATION } from '../core/analysis.js';
import { parseLocation, repositoryKey } from '../github/location.js';
import { loadManualReport, saveManualReport } from '../providers/manual.js';
import type { OverlayStatus } from '../shared/messages.js';
import {
  DEFAULT_SOURCE,
  loadSettings,
  repositoryConfig,
  saveSettings,
  withRepositoryConfig,
  type CoverageSource,
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
  repository: element('repository'),
  dot: element('status-dot'),
  message: element('status-message'),
  hint: element('status-hint'),
  source: element('status-source'),
  legend: element('legend'),
  legendGood: element('legend-good'),
  legendPartial: element('legend-partial'),
  legendBad: element('legend-bad'),
  setup: element('setup'),
  kind: element<HTMLSelectElement>('source-kind'),
  artifactName: element<HTMLInputElement>('artifact-name'),
  entryName: element<HTMLInputElement>('entry-name'),
  urlTemplate: element<HTMLInputElement>('url-template'),
  manualText: element<HTMLTextAreaElement>('manual-text'),
  manualFile: element<HTMLInputElement>('manual-file'),
  manualStatus: element('manual-status'),
  fieldArtifact: element('field-artifact'),
  fieldEntry: element('field-entry'),
  fieldTemplate: element('field-template'),
  fieldManual: element('field-manual'),
  save: element<HTMLButtonElement>('save'),
  refresh: element<HTMLButtonElement>('refresh'),
  enabled: element<HTMLInputElement>('repo-enabled'),
  openOptions: element<HTMLAnchorElement>('open-options'),
  openOptionsInline: element<HTMLAnchorElement>('open-options-inline'),
};

let activeTabId: number | null = null;
let owner = '';
let repo = '';

const STATE_TEXT: Record<OverlayStatus['state'], string> = {
  idle: 'Nothing to annotate on this page.',
  loading: 'Loading coverage…',
  ready: 'Coverage shown.',
  empty: 'Report loaded, but no lines matched this page.',
  error: 'Could not load coverage.',
  'not-configured': 'No coverage source configured yet.',
  disabled: 'Turned off.',
};

function showStatus(status: OverlayStatus): void {
  ui.dot.dataset['state'] = status.state;
  ui.message.textContent = status.message ?? STATE_TEXT[status.state];
  ui.hint.textContent = status.hint ?? '';
  ui.legend.hidden = status.state !== 'ready';

  // Relabel the legend in the report's own vocabulary: green means "covered" for a
  // coverage report but "killed" for a mutation one.
  const presentation = PRESENTATION[status.kind ?? 'coverage'];
  ui.legendGood.textContent = presentation.legend.good;
  ui.legendPartial.textContent = presentation.legend.partial;
  ui.legendBad.textContent = presentation.legend.bad;

  if (status.state === 'ready') {
    const parts = [
      `${status.annotated ?? 0} lines`,
      `${status.good ?? 0} ${presentation.legend.good}`,
      `${status.partial ?? 0} ${presentation.legend.partial}`,
      `${status.bad ?? 0} ${presentation.legend.bad}`,
      `${status.filesMatched ?? 0}/${status.filesTotal ?? 0} files matched`,
    ];
    ui.message.textContent = parts.join(' · ');
  }

  ui.source.textContent = status.label ? `${presentation.title} · ${status.label}` : '';
}

function applyKind(kind: CoverageSource['kind']): void {
  ui.fieldArtifact.hidden = kind !== 'github-actions';
  ui.fieldEntry.hidden = kind !== 'github-actions';
  ui.fieldTemplate.hidden = kind !== 'url-template';
  ui.fieldManual.hidden = kind !== 'manual';
}

function readSource(): CoverageSource {
  switch (ui.kind.value) {
    case 'url-template':
      return { kind: 'url-template', template: ui.urlTemplate.value.trim() };
    case 'manual':
      return { kind: 'manual' };
    default: {
      const entryName = ui.entryName.value.trim();
      return {
        kind: 'github-actions',
        artifactName: ui.artifactName.value.trim() || 'coverage*',
        ...(entryName ? { entryName } : {}),
      };
    }
  }
}

function writeSource(source: CoverageSource): void {
  ui.kind.value = source.kind;
  applyKind(source.kind);

  if (source.kind === 'github-actions') {
    ui.artifactName.value = source.artifactName;
    ui.entryName.value = source.entryName ?? '';
  } else if (source.kind === 'url-template') {
    ui.urlTemplate.value = source.template;
  }
}

async function refreshStatus(): Promise<void> {
  if (activeTabId === null) {
    return;
  }

  try {
    const status = (await chrome.tabs.sendMessage(activeTabId, {
      type: 'gutterhub:get-status',
    })) as OverlayStatus | undefined;

    showStatus(status ?? { state: 'idle' });
  } catch {
    // The content script is not injected on this page, or the tab was just reloaded.
    showStatus({
      state: 'idle',
      message: 'Reload the page to activate GutterHub.',
    });
  }
}

async function initialise(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;

  const context = tab?.url ? parseLocation(tab.url) : null;
  if (!context) {
    ui.repository.textContent = 'Open a pull request, file or commit on GitHub.';
    ui.setup.hidden = true;
    return;
  }

  owner = context.owner;
  repo = context.repo;
  const key = repositoryKey(context);
  ui.repository.textContent = key;
  ui.setup.hidden = false;

  const settings = await loadSettings();
  const config = repositoryConfig(settings, key);

  ui.enabled.checked = config?.enabled ?? true;
  writeSource(config?.source ?? DEFAULT_SOURCE);

  const manual = await loadManualReport(owner, repo);
  if (manual) {
    ui.manualStatus.textContent = `Currently holding ${manual.fileName} (${(
      manual.text.length / 1024
    ).toFixed(0)} KiB), saved ${new Date(manual.savedAt).toLocaleString()}.`;
  }

  await refreshStatus();
}

ui.kind.addEventListener('change', () => applyKind(ui.kind.value as CoverageSource['kind']));

ui.manualFile.addEventListener('change', async () => {
  const file = ui.manualFile.files?.[0];
  if (!file) {
    return;
  }
  ui.manualText.value = await file.text();
  ui.manualStatus.textContent = `Loaded ${file.name}. Press Save to store it.`;
  ui.manualText.dataset['fileName'] = file.name;
});

ui.save.addEventListener('click', async () => {
  ui.save.disabled = true;

  try {
    const source = readSource();

    if (source.kind === 'manual' && ui.manualText.value.trim().length > 0) {
      await saveManualReport(owner, repo, {
        text: ui.manualText.value,
        fileName: ui.manualText.dataset['fileName'] ?? 'pasted-report',
      });
      ui.manualStatus.textContent = 'Saved.';
    }

    const settings = await loadSettings();
    const key = `${owner}/${repo}`;
    const existing = repositoryConfig(settings, key);

    const config: RepositoryConfig = {
      key,
      enabled: ui.enabled.checked,
      source,
      paths: existing?.paths ?? {},
    };

    await saveSettings(withRepositoryConfig(settings, config));

    if (activeTabId !== null) {
      await chrome.tabs.sendMessage(activeTabId, { type: 'gutterhub:refresh' }).catch(() => {});
    }

    setTimeout(refreshStatus, 400);
  } finally {
    ui.save.disabled = false;
  }
});

ui.refresh.addEventListener('click', async () => {
  if (activeTabId === null) {
    return;
  }
  await chrome.runtime.sendMessage({ type: 'gutterhub:invalidate' }).catch(() => {});
  await chrome.tabs.sendMessage(activeTabId, { type: 'gutterhub:refresh' }).catch(() => {});
  showStatus({ state: 'loading' });
  setTimeout(refreshStatus, 600);
});

for (const link of [ui.openOptions, ui.openOptionsInline]) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

void initialise();
