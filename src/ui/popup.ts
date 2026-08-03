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
  fieldAzure: element('field-azure'),
  azureOrg: element<HTMLInputElement>('azure-org'),
  azureProject: element<HTMLInputElement>('azure-project'),
  azureArtifact: element<HTMLInputElement>('azure-artifact'),
  openOptionsAzure: element<HTMLAnchorElement>('open-options-azure'),
  conflicts: element('conflicts'),
  warnings: element('warnings'),
  secondEnabled: element<HTMLInputElement>('second-enabled'),
  secondBlock: element('second-block'),
  secondKind: element<HTMLSelectElement>('second-kind'),
  secondArtifactName: element<HTMLInputElement>('second-artifact-name'),
  secondUrlTemplate: element<HTMLInputElement>('second-url-template'),
  secondManualText: element<HTMLTextAreaElement>('second-manual-text'),
  secondManualFile: element<HTMLInputElement>('second-manual-file'),
  secondManualStatus: element('second-manual-status'),
  secondFieldArtifact: element('second-field-artifact'),
  secondFieldTemplate: element('second-field-template'),
  secondFieldManual: element('second-field-manual'),
  secondFieldAzure: element('second-field-azure'),
  secondAzureOrg: element<HTMLInputElement>('second-azure-org'),
  secondAzureProject: element<HTMLInputElement>('second-azure-project'),
  secondAzureArtifact: element<HTMLInputElement>('second-azure-artifact'),
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

/** The slot name under which the second hand-uploaded report is stored. */
const SECOND_SLOT = 'second';

function showStatus(status: OverlayStatus): void {
  ui.dot.dataset['state'] = status.state;
  ui.message.textContent = status.message ?? STATE_TEXT[status.state];
  ui.hint.textContent = status.hint ?? '';
  ui.legend.hidden = status.state !== 'ready';

  const kinds = status.kinds?.length ? status.kinds : (['coverage'] as const);
  // With one report the legend speaks that report's language; with two, the words would
  // contradict each other, so fall back to neutral ones.
  const legend =
    kinds.length === 1
      ? PRESENTATION[kinds[0]!].legend
      : { good: 'good', partial: 'partial', bad: 'needs tests' };

  ui.legendGood.textContent = legend.good;
  ui.legendPartial.textContent = legend.partial;
  ui.legendBad.textContent = legend.bad;

  if (status.state === 'ready') {
    ui.message.textContent = [
      `${status.annotated ?? 0} lines`,
      `${status.good ?? 0} ${legend.good}`,
      `${status.partial ?? 0} ${legend.partial}`,
      `${status.bad ?? 0} ${legend.bad}`,
      `${status.filesMatched ?? 0}/${status.filesTotal ?? 0} files matched`,
    ].join(' · ');
  }

  const conflicts = status.conflicts ?? 0;
  ui.conflicts.hidden = conflicts === 0;
  if (conflicts > 0) {
    ui.conflicts.textContent =
      `⚠ ${conflicts} line${conflicts === 1 ? '' : 's'} where the reports disagree — ` +
      'covered, but the tests would not notice it breaking.';
  }

  const warnings = status.warnings ?? [];
  ui.warnings.hidden = warnings.length === 0;
  ui.warnings.textContent = warnings.join(' · ');

  const labels = status.labels ?? [];
  ui.source.textContent = labels.length
    ? labels
        .map((label, index) => `${PRESENTATION[kinds[index] ?? 'coverage'].title} · ${label}`)
        .join('\n')
    : '';
}

function applyKind(kind: CoverageSource['kind']): void {
  ui.fieldArtifact.hidden = kind !== 'github-actions';
  ui.fieldEntry.hidden = kind !== 'github-actions';
  ui.fieldTemplate.hidden = kind !== 'url-template';
  ui.fieldManual.hidden = kind !== 'manual';
  ui.fieldAzure.hidden = kind !== 'azure-devops';
}

function applySecondKind(kind: CoverageSource['kind']): void {
  ui.secondFieldArtifact.hidden = kind !== 'github-actions';
  ui.secondFieldTemplate.hidden = kind !== 'url-template';
  ui.secondFieldManual.hidden = kind !== 'manual';
  ui.secondFieldAzure.hidden = kind !== 'azure-devops';
}

function readSecondSource(): CoverageSource {
  switch (ui.secondKind.value) {
    case 'url-template':
      return { kind: 'url-template', template: ui.secondUrlTemplate.value.trim() };
    case 'github-actions':
      return {
        kind: 'github-actions',
        artifactName: ui.secondArtifactName.value.trim() || 'mutation*',
      };
    case 'azure-devops':
      return {
        kind: 'azure-devops',
        organisation: ui.secondAzureOrg.value.trim(),
        project: ui.secondAzureProject.value.trim(),
        artifactName: ui.secondAzureArtifact.value.trim() || 'mutation*',
      };
    default:
      return { kind: 'manual', slot: SECOND_SLOT };
  }
}

function writeSecondSource(source: CoverageSource | undefined): void {
  ui.secondEnabled.checked = source !== undefined;
  ui.secondBlock.hidden = source === undefined;

  const kind = source?.kind ?? 'manual';
  ui.secondKind.value = kind;
  applySecondKind(kind);

  if (source?.kind === 'github-actions') {
    ui.secondArtifactName.value = source.artifactName;
  } else if (source?.kind === 'url-template') {
    ui.secondUrlTemplate.value = source.template;
  } else if (source?.kind === 'azure-devops') {
    ui.secondAzureOrg.value = source.organisation;
    ui.secondAzureProject.value = source.project;
    ui.secondAzureArtifact.value = source.artifactName;
  }
}

function readSource(): CoverageSource {
  switch (ui.kind.value) {
    case 'url-template':
      return { kind: 'url-template', template: ui.urlTemplate.value.trim() };
    case 'manual':
      return { kind: 'manual' };
    case 'azure-devops':
      return {
        kind: 'azure-devops',
        organisation: ui.azureOrg.value.trim(),
        project: ui.azureProject.value.trim(),
        artifactName: ui.azureArtifact.value.trim() || 'coverage*',
      };
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
  } else if (source.kind === 'azure-devops') {
    ui.azureOrg.value = source.organisation;
    ui.azureProject.value = source.project;
    ui.azureArtifact.value = source.artifactName;
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
  writeSource(config?.sources?.[0] ?? DEFAULT_SOURCE);
  writeSecondSource(config?.sources?.[1]);

  const describe = (report: { fileName: string; text: string; savedAt: number }) =>
    `Currently holding ${report.fileName} (${(report.text.length / 1024).toFixed(0)} KiB), ` +
    `saved ${new Date(report.savedAt).toLocaleString()}.`;

  const manual = await loadManualReport(owner, repo);
  if (manual) {
    ui.manualStatus.textContent = describe(manual);
  }

  const second = await loadManualReport(owner, repo, SECOND_SLOT);
  if (second) {
    ui.secondManualStatus.textContent = describe(second);
  }

  await refreshStatus();
}

ui.kind.addEventListener('change', () => applyKind(ui.kind.value as CoverageSource['kind']));
ui.secondKind.addEventListener('change', () =>
  applySecondKind(ui.secondKind.value as CoverageSource['kind']),
);
ui.secondEnabled.addEventListener('change', () => {
  ui.secondBlock.hidden = !ui.secondEnabled.checked;
});

/** Reads a picked file into a textarea, remembering the name for format detection. */
function wireFileInput(
  input: HTMLInputElement,
  textarea: HTMLTextAreaElement,
  status: HTMLElement,
): void {
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    textarea.value = await file.text();
    textarea.dataset['fileName'] = file.name;
    status.textContent = `Loaded ${file.name}. Press Save to store it.`;
  });
}

wireFileInput(ui.manualFile, ui.manualText, ui.manualStatus);
wireFileInput(ui.secondManualFile, ui.secondManualText, ui.secondManualStatus);

ui.save.addEventListener('click', async () => {
  ui.save.disabled = true;

  try {
    const sources: CoverageSource[] = [readSource()];

    if (sources[0]!.kind === 'manual' && ui.manualText.value.trim().length > 0) {
      await saveManualReport(owner, repo, {
        text: ui.manualText.value,
        fileName: ui.manualText.dataset['fileName'] ?? 'pasted-report',
      });
      ui.manualStatus.textContent = 'Saved.';
    }

    if (ui.secondEnabled.checked) {
      const second = readSecondSource();
      sources.push(second);

      if (second.kind === 'manual' && ui.secondManualText.value.trim().length > 0) {
        await saveManualReport(
          owner,
          repo,
          {
            text: ui.secondManualText.value,
            fileName: ui.secondManualText.dataset['fileName'] ?? 'pasted-report',
          },
          SECOND_SLOT,
        );
        ui.secondManualStatus.textContent = 'Saved.';
      }
    }

    const settings = await loadSettings();
    const key = `${owner}/${repo}`;
    const existing = repositoryConfig(settings, key);

    // Azure DevOps is not in `host_permissions`, so the extension cannot reach it until
    // the user grants access. Asking here works because the Save click is a user gesture,
    // which `permissions.request` requires; asking from the background would be rejected.
    if (sources.some((source) => source.kind === 'azure-devops')) {
      const origins = ['https://dev.azure.com/*'];
      const granted =
        (await chrome.permissions.contains({ origins })) ||
        (await chrome.permissions.request({ origins }));

      if (!granted) {
        ui.hint.textContent =
          'Azure DevOps access was declined, so those reports cannot be fetched. ' +
          'Press Save again to be asked once more.';
        return;
      }
    }

    const config: RepositoryConfig = {
      key,
      enabled: ui.enabled.checked,
      sources,
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

for (const link of [ui.openOptions, ui.openOptionsInline, ui.openOptionsAzure]) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

void initialise();
