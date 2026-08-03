import type { AnalysedFile, FileSummary, ReportKind } from '../core/analysis.js';
import { parseAnalysis } from '../core/parse.js';
import { PathIndex } from '../core/pathMatch.js';
import { collectFileBlocks } from '../github/adapters/index.js';
import { parseLocation, repositoryKey, samePage, type PageContext } from '../github/location.js';
import { addStats, clearBlock, emptyStats, renderBlock } from '../github/render.js';
import { isMessage, type OverlayStatus, type ResolveCoverageResponse } from '../shared/messages.js';
import { loadSettings, repositoryConfig, type GlobalSettings } from '../shared/settings.js';

const RENDER_DEBOUNCE_MS = 120;

interface LoadedAnalysis {
  kind: ReportKind;
  index: PathIndex<AnalysedFile>;
  label: string;
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

/** Adds a per-file headline figure next to the file name in a diff header. */
function renderBadge(root: HTMLElement, summary: FileSummary | null): void {
  const header = root.querySelector<HTMLElement>(
    '.file-info, .file-header, [data-testid="file-header"]',
  );
  if (!header) {
    return;
  }

  const existing = header.querySelector<HTMLElement>('.gutterhub-badge');
  if (summary === null || summary.percent === null) {
    existing?.remove();
    return;
  }

  const badge = existing ?? document.createElement('span');
  badge.className = 'gutterhub-badge';
  badge.dataset['level'] = badgeLevel(summary.percent);
  badge.textContent = `${summary.percent.toFixed(0)}% ${summary.label}`;
  badge.title = 'Whole-file figure for this report, from GutterHub';

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

    const file = loaded.index.lookup(block.path);
    if (!file) {
      // Leave unmatched files completely untouched: a half-painted diff reads as
      // "this code is untested" rather than "no data for this file".
      clearBlock(block.root);
      renderBadge(block.root, null);
      continue;
    }

    matched++;
    stats = addStats(stats, renderBlock(block, file.marks(markOptions), options));
    // The badge reports the whole file, not just the lines visible in a diff.
    renderBadge(block.root, file.summary());
  }

  setStatus({
    state: stats.annotated > 0 ? 'ready' : 'empty',
    adapterId,
    kind: loaded.kind,
    label: loaded.label,
    repositoryKey: repositoryKey(currentContext),
    annotated: stats.annotated,
    good: stats.good,
    partial: stats.partial,
    bad: stats.bad,
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

  try {
    const analysis = parseAnalysis(response.text, response.fileName);
    loaded = {
      kind: analysis.kind,
      index: new PathIndex(analysis.files, config.paths),
      label: response.label,
      sha: response.sha,
    };
  } catch (error) {
    loaded = null;
    clearOverlay();
    setStatus({
      state: 'error',
      repositoryKey: repositoryKey(context),
      message: error instanceof Error ? error.message : 'Could not parse the report.',
    });
    return;
  }

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
