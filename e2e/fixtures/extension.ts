/**
 * Playwright test harness for the built Chrome extension.
 *
 * Everything runs through a real persistent context with `dist/chrome` loaded, one context
 * per test for isolation. The harness carries the awkward parts that a plain page cannot
 * reach:
 *
 *   - **seeding** goes through an extension page, the only context with `chrome.storage`
 *     access, and batches every write into a single `set` so the content script's
 *     storage-change listener does not clear-and-reload mid-assertion;
 *   - **overlay status** is read from the service worker, because `chrome.runtime` and
 *     `chrome.tabs` are unavailable in page context — the worker holds `chrome.tabs` and
 *     relays a message to the content script;
 *   - **offline mode** intercepts every request, fulfils github.com pages from saved
 *     markup, and blocks (and records) anything that would reach the real network, so the
 *     deterministic suite provably never talks to github.com.
 */

import { dirname, join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  test as base,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';
import type { GutterHubTestOptions } from './config-types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION = join(ROOT, 'dist', 'chrome');

/** Default repository the fixtures configure; matches the live canary target. */
export const REPOSITORY = 'Evangelink/gutterhub';

export interface SeedOptions {
  repository?: string;
  /**
   * Extra manual source slots that are configured but never given a stored report, so the
   * background reports them as warnings while the real sources still resolve.
   */
  missingSlots?: string[];
}

export interface Marks {
  good: number;
  bad: number;
  partial: number;
  total: number;
  renderedLines: number;
  numbers: number[];
  tooltip: string;
  tinted: number;
}

/** Reads back what the content script painted onto a blob view. */
export function readMarks(page: Page): Promise<Marks> {
  return page.evaluate(() => ({
    good: document.querySelectorAll('.gutterhub-good.gutterhub-gutter').length,
    bad: document.querySelectorAll('.gutterhub-bad.gutterhub-gutter').length,
    partial: document.querySelectorAll('.gutterhub-partial.gutterhub-gutter').length,
    total: document.querySelectorAll('.gutterhub-gutter').length,
    renderedLines: document.querySelectorAll('.react-file-line[data-line-number]').length,
    numbers: [...document.querySelectorAll('.gutterhub-gutter')].map((element) =>
      Number.parseInt(element.getAttribute('data-line-number') ?? '0', 10),
    ),
    tooltip:
      document.querySelector('.gutterhub-good.gutterhub-gutter')?.getAttribute('title') ?? '',
    tinted: document.querySelectorAll('.gutterhub-row.gutterhub-highlight').length,
  }));
}

export class GutterHub {
  private readonly served = new Map<string, string>();
  private settingsPage: Page | undefined;
  /** github.com requests that escaped the offline fixtures — must stay empty offline. */
  readonly leaks: string[] = [];
  /** Uncaught errors seen on any opened page. */
  readonly pageErrors: string[] = [];

  constructor(
    readonly context: BrowserContext,
    readonly extensionId: string,
    readonly worker: Worker,
    private readonly offline: boolean,
  ) {}

  /** Installs the request interception that keeps the offline suite off the network. */
  async enableOffline(): Promise<void> {
    await this.context.route('**/*', async (route) => {
      const url = route.request().url();

      if (
        url.startsWith('chrome-extension://') ||
        url.startsWith('data:') ||
        url.startsWith('about:')
      ) {
        await route.continue();
        return;
      }

      const html = this.served.get(url);
      if (html !== undefined) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: html,
        });
        return;
      }

      // Anything not served from memory is a network escape. Record github.com hits so a
      // test can prove none happened, then block the request outright.
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        host = '';
      }
      if (host === 'github.com' || host === 'api.github.com' || host.endsWith('.github.com')) {
        this.leaks.push(url);
      }
      await route.abort();
    });
  }

  /** Registers saved markup to be served for an exact github.com URL (offline only). */
  serve(url: string, html: string): void {
    this.served.set(url, html);
  }

  /** An extension page, reused across seeds — the only context with `chrome.storage`. */
  async storagePage(): Promise<Page> {
    if (!this.settingsPage) {
      this.settingsPage = await this.context.newPage();
      await this.settingsPage.goto(`chrome-extension://${this.extensionId}/options.html`);
    }
    return this.settingsPage;
  }

  /**
   * Seeds one or more manual reports and the matching per-repository settings in a single
   * `chrome.storage` write per area, and returns the number of configured sources.
   */
  async seed(reports: string[], options: SeedOptions = {}): Promise<number> {
    const repository = options.repository ?? REPOSITORY;
    const missingSlots = options.missingSlots ?? [];
    const page = await this.storagePage();

    return page.evaluate(
      async ([texts, repo, phantom]) => {
        const key = repo.toLowerCase();
        const payload: Record<string, unknown> = {};
        const sources: Array<{ kind: 'manual'; slot?: string }> = [];

        texts.forEach((text, index) => {
          const slot = index === 0 ? undefined : `s${index}`;
          payload[slot ? `gutterhub:manual:${key}:${slot}` : `gutterhub:manual:${key}`] = {
            text,
            fileName: 'report',
            savedAt: Date.now(),
          };
          sources.push(slot ? { kind: 'manual', slot } : { kind: 'manual' });
        });

        // Configured but deliberately unstored: forces the background to warn.
        for (const slot of phantom) {
          sources.push({ kind: 'manual', slot });
        }

        await chrome.storage.local.set(payload);
        await chrome.storage.sync.set({
          'gutterhub:settings': {
            enabled: true,
            highlightLines: true,
            showPartial: true,
            githubToken: '',
            enterpriseHosts: [],
            repositories: {
              [key]: { key: repo, enabled: true, sources, paths: {} },
            },
          },
        });

        const stored = await chrome.storage.sync.get('gutterhub:settings');
        return (stored['gutterhub:settings'] as { repositories: Record<string, { sources: [] }> })
          .repositories[key]!.sources.length;
      },
      [reports, repository, missingSlots] as const,
    );
  }

  /**
   * Opens a page and waits for the overlay to settle. A storage write makes the content
   * script clear and repaint, so this waits for the mark count to hold steady rather than
   * asserting mid-repaint.
   */
  async open(url: string): Promise<Page> {
    const page = await this.context.newPage();
    page.on('pageerror', (error) => this.pageErrors.push(`${url}: ${error.message}`));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.gutterhub-gutter', { timeout: 30_000 }).catch(() => {});

    let previous = -1;
    for (let attempt = 0; attempt < 20; attempt++) {
      const count = await page.evaluate(
        () => document.querySelectorAll('.gutterhub-gutter').length,
      );
      if (count > 0 && count === previous) {
        break;
      }
      previous = count;
      await page.waitForTimeout(250);
    }

    return page;
  }

  /**
   * Asks the content script what it thinks it did, routed through the service worker which
   * holds `chrome.tabs`. `chrome.runtime`/`chrome.tabs` are not exposed to page context.
   */
  async overlayStatus(): Promise<unknown> {
    return this.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://github.com/*' });
      if (!tab?.id) {
        return null;
      }
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: 'gutterhub:get-status' });
      } catch {
        return null;
      }
    });
  }

  /**
   * Reads the persisted settings straight from `chrome.storage.sync`, via the service
   * worker, so a test can assert what actually survived a save rather than trusting the
   * page's DOM. Returns the repository keys currently stored.
   */
  async storedRepositoryKeys(): Promise<string[]> {
    return this.worker.evaluate(async () => {
      const stored = await chrome.storage.sync.get('gutterhub:settings');
      const settings = stored['gutterhub:settings'] as
        { repositories?: Record<string, unknown> } | undefined;
      return Object.keys(settings?.repositories ?? {});
    });
  }
}

interface Fixtures {
  gutterhub: GutterHub;
  extensionId: string;
  serviceWorker: Worker;
}

export const test = base.extend<Fixtures & GutterHubTestOptions>({
  offline: [false, { option: true }],
  browserChannel: [process.env['GUTTERHUB_E2E_CHANNEL'] ?? 'chromium', { option: true }],

  context: async ({ browserChannel }, use, testInfo) => {
    // Extensions are unavailable in the old headless shell, so a real browser build is
    // driven in its (new) headless mode, exactly as users run it.
    //
    // GUTTERHUB_E2E_PROXY points Chromium at a (typically unreachable) proxy, which is how
    // the offline suite is proven genuinely offline: with real egress broken it still has
    // to pass, because every request is served from memory or aborted before it leaves.
    //
    // Video is owned here, not by the `video` use-option: because the extension needs a
    // persistent context launched by hand, Playwright never creates the context and so its
    // built-in video capture never runs. `recordVideo` on every launched context records
    // all pages — github views, popup and options alike — and the teardown below keeps the
    // recordings only when a test fails unexpectedly, matching retain-on-failure.
    const proxy = process.env['GUTTERHUB_E2E_PROXY'];
    const videoDir = testInfo.outputPath('videos');
    const context = await chromium.launchPersistentContext('', {
      channel: browserChannel,
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
      recordVideo: { dir: videoDir },
      ...(proxy ? { proxy: { server: proxy } } : {}),
    });

    await use(context);

    // Closing flushes every page's video to disk. Attach the recordings on an unexpected
    // failure so they surface in the HTML report, and delete them otherwise so a green run
    // leaves nothing behind.
    await context.close();

    const failed = testInfo.status !== testInfo.expectedStatus;
    if (failed) {
      let files: string[] = [];
      try {
        files = (await readdir(videoDir)).filter((name) => name.endsWith('.webm'));
      } catch {
        files = [];
      }
      await Promise.all(
        files.map((name, index) =>
          testInfo.attach(files.length > 1 ? `video-${index + 1}` : 'video', {
            path: join(videoDir, name),
            contentType: 'video/webm',
          }),
        ),
      );
    } else {
      await rm(videoDir, { recursive: true, force: true });
    }
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) {
      worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },

  gutterhub: async ({ context, extensionId, serviceWorker, offline }, use) => {
    const gutterhub = new GutterHub(context, extensionId, serviceWorker, offline);
    if (offline) {
      await gutterhub.enableOffline();
    }
    await use(gutterhub);
  },
});

export const expect = test.expect;
