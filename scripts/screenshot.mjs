/**
 * Captures README screenshots of the overlay on live GitHub pages.
 *
 *   node scripts/screenshot.mjs
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'dist', 'chrome');
const OUTPUT = join(ROOT, 'docs', 'images');

const REPOSITORY = 'Evangelink/gutterhub';
const REPORT_PATH = '/home/runner/work/gutterhub/gutterhub/src/core/model.ts';

function buildReport() {
  const lines = ['TN:', `SF:${REPORT_PATH}`];
  for (let line = 1; line <= 300; line++) {
    const hits = line % 7 === 0 ? 0 : line;
    lines.push(`DA:${line},${hits}`);
    if (line % 11 === 0 && hits > 0) {
      lines.push(`BRDA:${line},0,0,${hits}`, `BRDA:${line},0,1,-`);
    }
  }
  lines.push('end_of_record', '');
  return lines.join('\n');
}

mkdirSync(OUTPUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'gutterhub-shot-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }
  const extensionId = new URL(worker.url()).host;

  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.evaluate(
    async ([report, repository]) => {
      const key = repository.toLowerCase();
      await chrome.storage.local.set({
        [`gutterhub:manual:${key}`]: { text: report, fileName: 'lcov.info', savedAt: Date.now() },
      });
      await chrome.storage.sync.set({
        'gutterhub:settings': {
          enabled: true,
          highlightLines: true,
          showPartial: true,
          githubToken: '',
          enterpriseHosts: [],
          repositories: {
            [key]: { key: repository, enabled: true, source: { kind: 'manual' }, paths: {} },
          },
        },
      });
    },
    [buildReport(), REPOSITORY],
  );
  await settings.close();

  const page = await context.newPage();
  await page.goto(`https://github.com/${REPOSITORY}/blob/main/src/core/model.ts`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForSelector('.gutterhub-gutter', { timeout: 30_000 });
  await page.waitForTimeout(1500);

  const code = page.locator('.react-code-file-contents').first();
  await code.screenshot({ path: join(OUTPUT, 'file-view.png') });
  console.log('docs/images/file-view.png');

  const options = await context.newPage();
  await options.setViewportSize({ width: 860, height: 1100 });
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForTimeout(600);
  await options.screenshot({ path: join(OUTPUT, 'options.png') });
  console.log('docs/images/options.png');
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
