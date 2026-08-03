/**
 * End-to-end smoke test.
 *
 * Loads the built Chrome extension into a real browser, points it at a live GitHub page,
 * and checks that coverage markers actually appear. Unit tests cover the parsing, path
 * matching and rendering in isolation; this is the only check that the manifest is valid,
 * the content script is injected, page detection fires, background messaging works and
 * the adapters match GitHub's *current* markup rather than the fixtures.
 *
 *   node scripts/e2e.mjs [--headed]
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'dist', 'chrome');
const headed = process.argv.includes('--headed');

/** A file in this repository, with a report that deliberately disagrees on the path root. */
const TARGET = 'https://github.com/Evangelink/gutterhub/blob/main/src/core/model.ts';
const REPORT = [
  'TN:',
  'SF:/home/runner/work/gutterhub/gutterhub/src/core/model.ts',
  'DA:1,5',
  'DA:2,5',
  'DA:3,0',
  'DA:4,7',
  'BRDA:4,0,0,7',
  'BRDA:4,0,1,-',
  'end_of_record',
  '',
].join('\n');

const failures = [];

function check(description, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${description}`);
  } else {
    console.log(`  FAIL  ${description}${detail ? ` — ${detail}` : ''}`);
    failures.push(description);
  }
}

if (!existsSync(EXTENSION)) {
  console.error('dist/chrome is missing — run "npm run build" first.');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'gutterhub-e2e-'));
let context;

try {
  context = await chromium.launchPersistentContext(profile, {
    // Extensions are unavailable in the old headless shell, so use the real browser
    // in its headless mode.
    channel: 'chromium',
    headless: !headed,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });

  // The service worker starts lazily; give it a moment to register.
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }

  const extensionId = new URL(worker.url()).host;
  console.log(`extension id: ${extensionId}`);
  check('background service worker started', Boolean(extensionId));

  // Seed configuration through an extension page, which is the only context with access
  // to the extension's storage.
  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${extensionId}/options.html`);

  const seeded = await settingsPage.evaluate(
    async ([report]) => {
      await chrome.storage.local.set({
        'gutterhub:manual:evangelink/gutterhub': {
          text: report,
          fileName: 'lcov.info',
          savedAt: Date.now(),
        },
      });

      await chrome.storage.sync.set({
        'gutterhub:settings': {
          enabled: true,
          highlightLines: true,
          showPartial: true,
          githubToken: '',
          enterpriseHosts: [],
          repositories: {
            'evangelink/gutterhub': {
              key: 'Evangelink/gutterhub',
              enabled: true,
              source: { kind: 'manual' },
              paths: {},
            },
          },
        },
      });

      const stored = await chrome.storage.sync.get('gutterhub:settings');
      return Object.keys(stored['gutterhub:settings'].repositories);
    },
    [REPORT],
  );

  check('settings written to extension storage', seeded.includes('evangelink/gutterhub'));
  await settingsPage.close();

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  await page
    .waitForSelector('.gutterhub-gutter', { timeout: 30_000 })
    .catch(() => console.log('  (no marker appeared within 30s)'));

  const result = await page.evaluate(() => ({
    covered: document.querySelectorAll('.gutterhub-covered.gutterhub-gutter').length,
    uncovered: document.querySelectorAll('.gutterhub-uncovered.gutterhub-gutter').length,
    partial: document.querySelectorAll('.gutterhub-partial.gutterhub-gutter').length,
    total: document.querySelectorAll('.gutterhub-gutter').length,
    // Line 5 onwards is absent from the report and must stay unmarked.
    marked: [...document.querySelectorAll('.gutterhub-gutter')].map((element) =>
      Number.parseInt(
        element.getAttribute('data-line-number') ?? element.textContent.trim(),
        10,
      ),
    ),
    tooltip:
      document.querySelector('.gutterhub-covered.gutterhub-gutter')?.getAttribute('title') ?? '',
  }));

  console.log(`  markers: ${JSON.stringify(result)}`);

  check('markers were drawn on a live GitHub page', result.total > 0);
  check('covered lines are green', result.covered === 2, `got ${result.covered}, expected 2`);
  check('uncovered lines are red', result.uncovered === 1, `got ${result.uncovered}, expected 1`);
  check('branch-partial line is amber', result.partial === 1, `got ${result.partial}, expected 1`);
  check(
    'an absolute CI path resolved to the repository path',
    result.total === 4,
    `got ${result.total}, expected 4`,
  );
  check(
    'only the reported lines were marked',
    result.marked.every((line) => line >= 1 && line <= 4),
    JSON.stringify(result.marked),
  );
  check('tooltips carry the hit count', /hit/.test(result.tooltip), result.tooltip);
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));

  const status = await page.evaluate(
    () =>
      new Promise((resolve) =>
        chrome.runtime.sendMessage({ type: 'gutterhub:get-status' }, resolve),
      ),
  ).catch(() => null);
  if (status) {
    console.log(`  status: ${JSON.stringify(status)}`);
  }
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nAll end-to-end checks passed.');
