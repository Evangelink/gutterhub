/**
 * End-to-end smoke test.
 *
 * Loads the built Chrome extension into a real browser, points it at live GitHub pages,
 * and checks that marks actually appear. Unit tests cover parsing, path matching and
 * rendering in isolation; this is the only check that the manifest is valid, the content
 * script is injected, page detection fires, background messaging works, and the adapters
 * match GitHub's *current* markup rather than the fixtures.
 *
 * Both report kinds are exercised, because "a second kind of report is additive" is a
 * claim about the whole pipeline, not just about the core.
 *
 *   node scripts/e2e.mjs [--headed]
 *   GUTTERHUB_E2E_PR=<pull request files url> node scripts/e2e.mjs
 *   GUTTERHUB_E2E_CHANNEL=msedge node scripts/e2e.mjs
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = join(ROOT, 'dist', 'chrome');
const headed = process.argv.includes('--headed');
/**
 * Which browser build to drive. Defaults to Playwright's own Chromium; set `msedge` or
 * `chrome` to verify against a real installed browser, which is what users actually run.
 */
const CHANNEL = process.env['GUTTERHUB_E2E_CHANNEL'] ?? 'chromium';

const REPOSITORY = 'Evangelink/gutterhub';
const FILE_PATH = 'src/core/model.ts';
const BLOB_URL = `https://github.com/${REPOSITORY}/blob/main/${FILE_PATH}`;
/** Optional: a pull request touching the same file, to exercise the diff adapter. */
const PR_URL = process.env['GUTTERHUB_E2E_PR'] ?? '';

/**
 * Coverage report. The path is deliberately an absolute CI path, so a pass also proves
 * that suffix matching maps build paths onto repository paths.
 */
function coverageReport() {
  const lines = [
    'TN:',
    `SF:/home/runner/work/gutterhub/gutterhub/${FILE_PATH}`,
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

/** Mutation report in the mutation-testing-elements schema. */
function mutationReport() {
  const mutants = [];
  let id = 0;

  const push = (line, status) =>
    mutants.push({
      id: String(id++),
      mutatorName: status === 'Survived' ? 'EqualityOperator' : 'ConditionalExpression',
      status,
      location: { start: { line, column: 1 }, end: { line, column: 20 } },
    });

  // Line 1 all killed, line 2 mixed (the case coverage cannot see), line 3 survived.
  push(1, 'Killed');
  push(1, 'Killed');
  push(2, 'Killed');
  push(2, 'Survived');
  push(3, 'Survived');

  for (let line = 4; line <= 140; line++) {
    push(line, line % 4 === 0 ? 'Survived' : 'Killed');
  }

  return JSON.stringify({
    schemaVersion: '2.0',
    thresholds: { high: 80, low: 60 },
    files: { [FILE_PATH]: { language: 'typescript', source: '// omitted', mutants } },
  });
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
    // Extensions are unavailable in the old headless shell, so use a real browser
    // build in its headless mode.
    channel: CHANNEL,
    headless: !headed,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });

  // The service worker starts lazily; give it a moment to register.
  let [worker] = context.serviceWorkers();
  if (!worker) {
    worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  }

  const extensionId = new URL(worker.url()).host;
  console.log(`channel: ${CHANNEL}`);
  console.log(`extension id: ${extensionId}`);
  check('background service worker started', Boolean(extensionId));

  const settingsPage = await context.newPage();
  await settingsPage.goto(`chrome-extension://${extensionId}/options.html`);

  /**
   * Seeds one or two reports through an extension page, the only context with storage
   * access. Every write is batched into a single `set` call: each storage change makes
   * the content script clear and reload the overlay, so writing per-report races the
   * assertions that follow.
   */
  async function seed(reports) {
    return settingsPage.evaluate(
      async ([texts, repository]) => {
        const key = repository.toLowerCase();
        const payload = {};
        const sources = [];

        texts.forEach((text, index) => {
          const slot = index === 0 ? undefined : `s${index}`;
          payload[slot ? `gutterhub:manual:${key}:${slot}` : `gutterhub:manual:${key}`] = {
            text,
            fileName: 'report',
            savedAt: Date.now(),
          };
          sources.push(slot ? { kind: 'manual', slot } : { kind: 'manual' });
        });

        await chrome.storage.local.set(payload);
        await chrome.storage.sync.set({
          'gutterhub:settings': {
            enabled: true,
            highlightLines: true,
            showPartial: true,
            githubToken: '',
            enterpriseHosts: [],
            repositories: {
              [key]: { key: repository, enabled: true, sources, paths: {} },
            },
          },
        });

        const stored = await chrome.storage.sync.get('gutterhub:settings');
        return stored['gutterhub:settings'].repositories[key].sources.length;
      },
      [reports, REPOSITORY],
    );
  }

  /** Asks the content script what it thinks it did. Routed via the service worker, which
   *  has `chrome.tabs`; `chrome.runtime` is not exposed to page context. */
  async function overlayStatus() {
    return worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://github.com/*', active: true });
      if (!tab?.id) return null;
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: 'gutterhub:get-status' });
      } catch {
        return null;
      }
    });
  }

  const pageErrors = [];

  async function open(url) {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(`${url}: ${error.message}`));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page
      .waitForSelector('.gutterhub-gutter', { timeout: 30_000 })
      .catch(() => console.log(`  (no marker appeared on ${url})`));

    // A storage write makes the content script clear and repaint. Wait for the mark
    // count to hold steady so assertions do not land mid-repaint.
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

  const readMarks = (page) =>
    page.evaluate(() => ({
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

  // ---------------------------------------------------------------- coverage
  console.log('\ncoverage report, file view');
  check('settings written to extension storage', (await seed([coverageReport()])) === 1);

  const blob = await open(BLOB_URL);
  const coverage = await readMarks(blob);
  console.log(`  ${coverage.renderedLines} rendered lines, ${coverage.total} marks`);

  check('marks were drawn on a live file view', coverage.total > 0);
  check(
    'an absolute CI path resolved to the repository path',
    coverage.total === coverage.renderedLines,
    `${coverage.total} marks for ${coverage.renderedLines} lines`,
  );
  check(
    'each line is marked exactly once',
    new Set(coverage.numbers).size === coverage.numbers.length,
    'duplicate line numbers found',
  );
  check('covered lines are green', coverage.good > 0);
  check('uncovered lines are red', coverage.bad > 0);
  check('a branch-partial line is amber', coverage.partial > 0);
  check('tooltips carry the hit count', /hit/.test(coverage.tooltip), coverage.tooltip);
  check('rows are tinted', coverage.tinted > 0);
  await blob.close();

  // ---------------------------------------------------------------- mutation
  // The point of the seam: a different report kind should light up the same pipeline
  // with no change to the renderer, the DOM adapters or the content script.
  console.log('\nmutation report, file view');
  await seed([mutationReport()]);

  const mutationPage = await open(BLOB_URL);
  const mutation = await readMarks(mutationPage);
  console.log(`  ${mutation.total} marks`);

  check('a mutation report also draws marks', mutation.total > 0);
  check('killed mutants are green', mutation.good > 0);
  check('surviving mutants are red', mutation.bad > 0);
  check(
    'a line with both killed and surviving mutants is amber',
    mutation.partial > 0,
    `partial=${mutation.partial}`,
  );
  check(
    'tooltips speak mutation, not coverage',
    /mutants killed/.test(mutation.tooltip),
    mutation.tooltip,
  );
  check(
    'each line is marked exactly once',
    new Set(mutation.numbers).size === mutation.numbers.length,
  );
  check(
    'the mutation report marks only the lines it mentions',
    mutation.total < coverage.total,
    `mutation=${mutation.total} coverage=${coverage.total}`,
  );
  await mutationPage.close();

  // ---------------------------------------------------------------- both at once
  // Coverage and mutation testing overlaid together. The interesting output is not
  // either report on its own but where they disagree: a line coverage paints green
  // whose mutants survived is code that looks tested and is not.
  console.log('\ncoverage + mutation together, file view');
  check('two sources accepted', (await seed([coverageReport(), mutationReport()])) === 2);

  const bothPage = await open(BLOB_URL);
  const both = await bothPage.evaluate(() => ({
    total: document.querySelectorAll('.gutterhub-gutter').length,
    dual: document.querySelectorAll('.gutterhub-gutter.gutterhub-dual').length,
    l1: document.querySelectorAll('[class*="gutterhub-l1-"]').length,
    l2: document.querySelectorAll('[class*="gutterhub-l2-"]').length,
    conflicts: document.querySelectorAll('.gutterhub-conflict').length,
    conflictTooltip: document.querySelector('.gutterhub-conflict')?.getAttribute('title') ?? '',
    badge: document.querySelector('.gutterhub-badge')?.textContent ?? '',
  }));

  console.log(`  ${both.total} marks, ${both.dual} dual, ${both.conflicts} conflicts`);
  if (both.total === 0) {
    console.log(`  overlay status: ${JSON.stringify(await overlayStatus())}`);
  }

  check('both reports render together', both.total > 0 && both.dual > 0);
  check('channel 1 is drawn', both.l1 > 0);
  check('channel 2 is drawn', both.l2 > 0);
  check(
    'lines where the reports disagree are flagged',
    both.conflicts > 0,
    `conflicts=${both.conflicts}`,
  );
  check(
    'the disagreement leads the tooltip',
    /disagree/i.test(both.conflictTooltip),
    both.conflictTooltip.split('\n')[0] ?? '',
  );
  check(
    'the tooltip names both reports',
    /Code coverage:/.test(both.conflictTooltip) && /Mutation testing:/.test(both.conflictTooltip),
    both.conflictTooltip.replace(/\n/g, ' | '),
  );
  await bothPage.close();

  // ---------------------------------------------------------------- diff view
  if (PR_URL) {
    console.log('\ncoverage report, pull request diff');
    await seed([coverageReport()]);
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

    console.log(`  ${prResult.rightCells} new-file lines, ${prResult.total} marks`);

    check('marks were drawn on a live pull request diff', prResult.total > 0);
    check(
      'every new-file line is marked',
      prResult.total === prResult.rightCells,
      `${prResult.total} marks for ${prResult.rightCells} lines`,
    );
    check('marks land on the new-file column', prResult.allOnRight);
    check('deletion rows are left alone', prResult.deletionsMarked === 0);
    check(
      'each diff line is marked exactly once',
      new Set(prResult.numbers).size === prResult.numbers.length,
    );
    check('the file header shows a badge', /% covered/.test(prResult.badge), prResult.badge);
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
