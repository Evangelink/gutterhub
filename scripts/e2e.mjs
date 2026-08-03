/**
 * End-to-end smoke test.
 *
 * Loads the built Chrome extension into a real browser, points it at live GitHub pages,
 * and checks that coverage markers actually appear. Unit tests cover parsing, path
 * matching and rendering in isolation; this is the only check that the manifest is valid,
 * the content script is injected, page detection fires, background messaging works, and
 * the adapters match GitHub's *current* markup rather than the fixtures.
 *
 *   node scripts/e2e.mjs [--headed]
 *   GUTTERHUB_E2E_PR=<pull request files url> node scripts/e2e.mjs
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'dist', 'chrome');
const headed = process.argv.includes('--headed');

const REPOSITORY = 'Evangelink/gutterhub';
const BLOB_URL = `https://github.com/${REPOSITORY}/blob/main/src/core/model.ts`;
/** Optional: a pull request touching the same file, to exercise the diff adapter. */
const PR_URL = process.env['GUTTERHUB_E2E_PR'] ?? '';

/**
 * The report deliberately uses an absolute CI path, so a pass also proves that suffix
 * matching maps build paths onto repository paths.
 */
const REPORT_PATH = '/home/runner/work/gutterhub/gutterhub/src/core/model.ts';

/** Fixed states for the first four lines, then a deterministic pattern for the rest. */
function buildReport() {
  const lines = [
    'TN:',
    `SF:${REPORT_PATH}`,
    'DA:1,5',
    'DA:2,5',
    'DA:3,0',
    'DA:4,7',
    'BRDA:4,0,0,7',
    'BRDA:4,0,1,-',
  ];

  for (let line = 5; line <= 300; line++) {
    lines.push(`DA:${line},${line % 3 === 0 ? 0 : line}`);
  }

  lines.push('end_of_record', '');
  return lines.join('\n');
}

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

  // Seed configuration through an extension page, the only context with access to
  // extension storage.
  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${extensionId}/options.html`);

  const seeded = await settingsPage.evaluate(
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

      const stored = await chrome.storage.sync.get('gutterhub:settings');
      return Object.keys(stored['gutterhub:settings'].repositories);
    },
    [buildReport(), REPOSITORY],
  );

  check('settings written to extension storage', seeded.includes(REPOSITORY.toLowerCase()));
  await settingsPage.close();

  const pageErrors = [];

  async function open(url) {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${url}: ${error.message}`));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page
      .waitForSelector('.gutterhub-gutter', { timeout: 30_000 })
      .catch(() => console.log(`  (no marker appeared on ${url})`));
    return page;
  }

  console.log('\nfile view');
  const blob = await open(BLOB_URL);

  const blobResult = await blob.evaluate(() => ({
    covered: document.querySelectorAll('.gutterhub-covered.gutterhub-gutter').length,
    uncovered: document.querySelectorAll('.gutterhub-uncovered.gutterhub-gutter').length,
    partial: document.querySelectorAll('.gutterhub-partial.gutterhub-gutter').length,
    total: document.querySelectorAll('.gutterhub-gutter').length,
    renderedLines: document.querySelectorAll('.react-file-line[data-line-number]').length,
    numbers: [...document.querySelectorAll('.gutterhub-gutter')].map((element) =>
      Number.parseInt(element.getAttribute('data-line-number') ?? '0', 10),
    ),
    tooltip:
      document.querySelector('.gutterhub-covered.gutterhub-gutter')?.getAttribute('title') ?? '',
    tinted: document.querySelectorAll('.gutterhub-row.gutterhub-highlight').length,
  }));

  console.log(`  ${blobResult.renderedLines} rendered lines, ${blobResult.total} markers`);

  check('markers were drawn on a live file view', blobResult.total > 0);
  check(
    'an absolute CI path resolved to the repository path',
    blobResult.total === blobResult.renderedLines,
    `${blobResult.total} markers for ${blobResult.renderedLines} lines`,
  );
  check(
    'each line is annotated exactly once',
    new Set(blobResult.numbers).size === blobResult.numbers.length,
    'duplicate line numbers found',
  );
  check('covered lines are green', blobResult.covered > 0);
  check('uncovered lines are red', blobResult.uncovered > 0);
  check('a branch-partial line is amber', blobResult.partial > 0);
  check('tooltips carry the hit count', /hit/.test(blobResult.tooltip), blobResult.tooltip);
  check('rows are tinted', blobResult.tinted > 0);
  await blob.close();

  if (PR_URL) {
    console.log('\npull request diff');
    const pr = await open(PR_URL);

    const prResult = await pr.evaluate(() => {
      const markers = [...document.querySelectorAll('.gutterhub-gutter')];

      return {
        total: markers.length,
        rightCells: document.querySelectorAll('td.blob-num.js-blob-rnum[data-line-number]').length,
        allOnRight: markers.every((element) => element.classList.contains('js-blob-rnum')),
        deletionsMarked: document.querySelectorAll('td.blob-num-deletion.gutterhub-gutter').length,
        numbers: markers.map((element) =>
          Number.parseInt(element.getAttribute('data-line-number') ?? '0', 10),
        ),
        badge: document.querySelector('.gutterhub-badge')?.textContent ?? '',
      };
    });

    console.log(`  ${prResult.rightCells} new-file lines, ${prResult.total} markers`);

    check('markers were drawn on a live pull request diff', prResult.total > 0);
    check(
      'every new-file line is annotated',
      prResult.total === prResult.rightCells,
      `${prResult.total} markers for ${prResult.rightCells} lines`,
    );
    check('markers land on the new-file column', prResult.allOnRight);
    check('deletion rows are left alone', prResult.deletionsMarked === 0);
    check(
      'each diff line is annotated exactly once',
      new Set(prResult.numbers).size === prResult.numbers.length,
    );
    check(
      'the file header shows a coverage badge',
      /% covered/.test(prResult.badge),
      prResult.badge,
    );
    await pr.close();
  } else {
    console.log('\npull request diff skipped (set GUTTERHUB_E2E_PR to a pull request files URL)');
  }

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '));
} finally {
  await context?.close();
  rmSync(profile, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}

console.log('\nAll end-to-end checks passed.');
