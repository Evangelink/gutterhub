import {
  PRESENTATION,
  type AnalysedFile,
  type FileSummary,
  type ReportKind,
} from '../core/analysis.js';
import { parseAnalysis } from '../core/parse.js';
import { PathIndex } from '../core/pathMatch.js';
import { collectFileBlocks } from '../github/adapters/index.js';
import { parseLocation, repositoryKey, samePage, type PageContext } from '../github/location.js';
import { addStats, clearBlock, emptyStats, renderBlock, type MarkLayer } from '../github/render.js';
import { isMessage, type OverlayStatus, type ResolveCoverageResponse } from '../shared/messages.js';
import { loadSettings, repositoryConfig, type GlobalSettings } from '../shared/settings.js';

const RENDER_DEBOUNCE_MS = 120;

interface LoadedReport {
  kind: ReportKind;
  index: PathIndex<AnalysedFile>;
  label: string;
}

interface LoadedAnalysis {
  reports: LoadedReport[];
  warnings: string[];
  sha: string;
}

let currentContext: PageContext | null = null;
let loaded: LoadedAnalysis | null = null;
let settings: GlobalSettings | null = null;
let status: OverlayStatus = { state: 'idle' };
let renderTimer: number | undefined;
let observer: MutationObserver | null = null;
/** Guards against a slow fetch painting a page the user has already navigated away from. */
let generation = 0;

function setStatus(next: OverlayStatus): void {
  status = next;
}

function scheduleRender(): void {
  if (renderTimer !== undefined) {
    clearTimeout(renderTimer);
  }
  renderTimer = setTimeout(render, RENDER_DEBOUNCE_MS) as unknown as number;
}

function badgeLevel(percent: number): 'good' | 'fair' | 'poor' {
  if (percent >= 80) {
    return 'good';
  }
  return percent >= 50 ? 'fair' : 'poor';
}

/** Adds per-file headline figures next to the file name in a diff header. */
function renderBadge(root: HTMLElement, summaries: FileSummary[]): void {
  const header = root.querySelector<HTMLElement>(
    '.file-info, .file-header, [data-testid="file-header"]',
  );
  if (!header) {
    return;
  }

  const usable = summaries.filter((summary) => summary.percent !== null);
  const existing = header.querySelector<HTMLElement>('.gutterhub-badge');

  if (usable.length === 0) {
    existing?.remove();
    return;
  }

  const badge = existing ?? document.createElement('span');
  badge.className = 'gutterhub-badge';
  // The lowest figure drives the colour, so a healthy coverage number cannot mask a
  // poor mutation score sitting right beside it.
  badge.dataset['level'] = badgeLevel(Math.min(...usable.map((summary) => summary.percent!)));
  badge.textContent = usable
    .map((summary) => `${summary.percent!.toFixed(0)}% ${summary.label}`)
    .join(' · ');
  badge.title = 'Whole-file figures for the loaded reports, from GutterHub';

  if (!existing) {
    header.appendChild(badge);
  }
}

function render(): void {
  if (currentContext === null || loaded === null || settings === null) {
    return;
  }

  const { blocks, adapterId } = collectFileBlocks(document, currentContext);
  if (blocks.length === 0) {
    return;
  }

  const options = { highlightLines: settings.highlightLines };
  const markOptions = { showPartial: settings.showPartial };

  let stats = emptyStats();
  let matched = 0;

  for (const block of blocks) {
    if (block.path === null) {
      continue;
    }

    const layers: MarkLayer[] = [];
    const summaries: FileSummary[] = [];

    for (const report of loaded.reports) {
      const file = report.index.lookup(block.path);
      if (!file) {
        continue;
      }
      layers.push({ title: PRESENTATION[report.kind].title, marks: file.marks(markOptions) });
      summaries.push(file.summary());
    }

    if (layers.length === 0) {
      // Leave unmatched files completely untouched: a half-painted diff reads as
      // "this code is untested" rather than "no data for this file".
      clearBlock(block.root);
      renderBadge(block.root, []);
      continue;
    }

    matched++;
    stats = addStats(stats, renderBlock(block, layers, options));
    // The badge reports the whole file, not just the lines visible in a diff.
    renderBadge(block.root, summaries);
  }

  setStatus({
    state: stats.annotated > 0 ? 'ready' : 'empty',
    adapterId,
    kinds: loaded.reports.map((report) => report.kind),
    labels: loaded.reports.map((report) => report.label),
    warnings: loaded.warnings,
    repositoryKey: repositoryKey(currentContext),
    annotated: stats.annotated,
    good: stats.good,
    partial: stats.partial,
    bad: stats.bad,
    conflicts: stats.conflicts,
    filesMatched: matched,
    filesTotal: blocks.length,
    ...(stats.annotated === 0
      ? {
          message: 'The report contains no lines for the files on this page.',
          hint: 'Check the path prefix settings if your report uses a different source root.',
        }
      : {}),
  });
}

function startObserving(): void {
  observer?.disconnect();

  // Pull request diffs load progressively and GitHub re-renders whole subtrees on
  // interaction, so the overlay has to be reapplied rather than painted once.
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE && !isOwnMutation(node as Element)) {
          scheduleRender();
          return;
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function isOwnMutation(element: Element): boolean {
  return element.classList?.contains('gutterhub-badge') ?? false;
}

function clearOverlay(): void {
  clearBlock(document);
  for (const badge of document.querySelectorAll('.gutterhub-badge')) {
    badge.remove();
  }
}

async function load(force = false): Promise<void> {
  const context = currentContext;
  if (context === null) {
    return;
  }

  const token = ++generation;
  setStatus({ state: 'loading', repositoryKey: repositoryKey(context) });

  settings = await loadSettings();

  if (!settings.enabled) {
    setStatus({ state: 'disabled', message: 'GutterHub is turned off.' });
    clearOverlay();
    return;
  }

  if (!repositoryConfig(settings, repositoryKey(context))) {
    setStatus({
      state: 'not-configured',
      repositoryKey: repositoryKey(context),
      message: `No coverage source configured for ${repositoryKey(context)}.`,
      hint: 'Open the GutterHub popup to set one up.',
    });
    clearOverlay();
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'gutterhub:resolve',
    context,
    force,
  })) as ResolveCoverageResponse | undefined;

  if (token !== generation) {
    return;
  }

  if (!response) {
    setStatus({ state: 'error', message: 'No response from the GutterHub background worker.' });
    return;
  }

  if (!response.ok) {
    loaded = null;
    clearOverlay();
    setStatus({
      state: response.reason === 'error' ? 'error' : response.reason,
      repositoryKey: repositoryKey(context),
      message: response.error,
      ...(response.hint ? { hint: response.hint } : {}),
    });
    return;
  }

  const config = repositoryConfig(settings, repositoryKey(context))!;

  const reports: LoadedReport[] = [];
  const warnings = [...response.warnings];

  for (const report of response.reports) {
    try {
      const analysis = parseAnalysis(report.text, report.fileName);
      reports.push({
        kind: analysis.kind,
        index: new PathIndex(analysis.files, config.paths),
        label: report.label,
      });
    } catch (error) {
      // One unreadable report should not discard the others.
      warnings.push(
        `${report.label}: ${error instanceof Error ? error.message : 'could not be parsed'}`,
      );
    }
  }

  if (reports.length === 0) {
    loaded = null;
    clearOverlay();
    setStatus({
      state: 'error',
      repositoryKey: repositoryKey(context),
      message: warnings[0] ?? 'Could not parse any of the configured reports.',
      warnings,
    });
    return;
  }

  loaded = { reports, warnings, sha: response.sha };

  render();
  startObserving();
}

function onNavigate(): void {
  const next = parseLocation(location.href);

  if (samePage(next, currentContext)) {
    // GitHub fires navigation events for in-page updates too; re-rendering is enough.
    if (next !== null && loaded !== null) {
      scheduleRender();
    }
    return;
  }

  currentContext = next;
  loaded = null;
  generation++;
  clearOverlay();

  if (next === null) {
    observer?.disconnect();
    observer = null;
    setStatus({ state: 'idle' });
    return;
  }

  void load();
}

/**
 * GitHub navigates with Turbo and, on older pages, pjax. Neither reliably emits an event
 * for every transition, so the History API is patched as well.
 */
function watchNavigation(): void {
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) {
    window.addEventListener(event, () => setTimeout(onNavigate, 0));
  }

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function patched(
      this: History,
      ...args: Parameters<History['pushState']>
    ): void {
      original.apply(this, args);
      setTimeout(onNavigate, 0);
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isMessage(message, 'gutterhub:get-status')) {
    sendResponse(status);
    return false;
  }

  if (isMessage(message, 'gutterhub:refresh')) {
    void load(true);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.storage.onChanged.addListener(() => {
  if (currentContext !== null) {
    clearOverlay();
    void load(true);
  }
});

watchNavigation();
onNavigate();
