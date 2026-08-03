/**
 * Live canary — the only check that the adapters still match GitHub's *current* markup.
 *
 * It drives real github.com with the built extension, so it needs network access. `npm run
 * e2e` runs it alongside the offline gate, which keeps the scheduled workflow a genuine
 * canary; `npm run e2e:offline` skips it. Point it at a diff too with
 * `GUTTERHUB_E2E_PR=<pull request files url>`.
 *
 * Note on Firefox: this suite is Chromium-only. Playwright can load an unpacked extension
 * only into Chromium, so `dist/firefox` is verified by hand (about:debugging), never here —
 * see playwright.config.ts and the README.
 */

import { REPOSITORY, readMarks, test, expect } from './fixtures/extension.js';
import { coverageReport, mutationReport } from './fixtures/reports.js';

const FILE_PATH = 'src/core/model.ts';
const BLOB_URL = `https://github.com/${REPOSITORY}/blob/main/${FILE_PATH}`;
const PR_URL = process.env['GUTTERHUB_E2E_PR'] ?? '';

const coverage = () => coverageReport({ path: FILE_PATH });
const mutation = () => mutationReport({ path: FILE_PATH });

test('file view: coverage, mutation, and both overlaid', async ({ gutterhub }) => {
  // ---- coverage ----
  expect(await gutterhub.seed([coverage()]), 'settings written to storage').toBe(1);
  const coveragePage = await gutterhub.open(BLOB_URL);
  const cover = await readMarks(coveragePage);

  expect(cover.total, 'marks were drawn on a live file view').toBeGreaterThan(0);
  expect(cover.total, 'an absolute CI path resolved to the repository path').toBe(
    cover.renderedLines,
  );
  expect(new Set(cover.numbers).size, 'each line is marked exactly once').toBe(
    cover.numbers.length,
  );
  expect(cover.good, 'covered lines are green').toBeGreaterThan(0);
  expect(cover.bad, 'uncovered lines are red').toBeGreaterThan(0);
  expect(cover.partial, 'a branch-partial line is amber').toBeGreaterThan(0);
  expect(cover.tooltip, 'tooltips carry the hit count').toMatch(/hit/);
  expect(cover.tinted, 'rows are tinted').toBeGreaterThan(0);
  console.log(
    `[live] coverage: ${cover.total} marks over ${cover.renderedLines} rendered lines ` +
      `(${cover.good} good, ${cover.partial} partial, ${cover.bad} bad)`,
  );
  await coveragePage.close();

  // ---- mutation ----
  await gutterhub.seed([mutation()]);
  const mutationPage = await gutterhub.open(BLOB_URL);
  const mut = await readMarks(mutationPage);

  expect(mut.total, 'a mutation report also draws marks').toBeGreaterThan(0);
  expect(mut.good, 'killed mutants are green').toBeGreaterThan(0);
  expect(mut.bad, 'surviving mutants are red').toBeGreaterThan(0);
  expect(mut.partial, 'a mixed line is amber').toBeGreaterThan(0);
  expect(mut.tooltip, 'tooltips speak mutation').toMatch(/mutants killed/);
  expect(new Set(mut.numbers).size, 'each line is marked exactly once').toBe(mut.numbers.length);
  expect(mut.total, 'the mutation report marks only the lines it mentions').toBeLessThan(
    cover.total,
  );
  console.log(
    `[live] mutation: ${mut.total} marks (${mut.good} good, ${mut.partial} partial, ${mut.bad} bad)`,
  );
  await mutationPage.close();

  // ---- both overlaid ----
  expect(await gutterhub.seed([coverage(), mutation()]), 'two sources accepted').toBe(2);
  const bothPage = await gutterhub.open(BLOB_URL);
  const both = await bothPage.evaluate(() => ({
    total: document.querySelectorAll('.gutterhub-gutter').length,
    dual: document.querySelectorAll('.gutterhub-gutter.gutterhub-dual').length,
    l1: document.querySelectorAll('[class*="gutterhub-l1-"]').length,
    l2: document.querySelectorAll('[class*="gutterhub-l2-"]').length,
    conflicts: document.querySelectorAll('.gutterhub-conflict').length,
    conflictTooltip: document.querySelector('.gutterhub-conflict')?.getAttribute('title') ?? '',
  }));

  if (both.total === 0) {
    // Mirror the old script's diagnostic when nothing painted.
    console.log(`overlay status: ${JSON.stringify(await gutterhub.overlayStatus())}`);
  }

  expect(both.total, 'both reports render together').toBeGreaterThan(0);
  expect(both.dual, 'lines carry two channels').toBeGreaterThan(0);
  expect(both.l1, 'channel 1 is drawn').toBeGreaterThan(0);
  expect(both.l2, 'channel 2 is drawn').toBeGreaterThan(0);
  expect(both.conflicts, 'lines where the reports disagree are flagged').toBeGreaterThan(0);
  expect(both.conflictTooltip, 'the disagreement leads the tooltip').toMatch(/disagree/i);
  expect(both.conflictTooltip, 'the tooltip names both reports').toMatch(/Code coverage:/);
  expect(both.conflictTooltip).toMatch(/Mutation testing:/);
  console.log(
    `[live] overlay: ${both.total} marks, ${both.dual} dual, ${both.conflicts} conflicts`,
  );
  await bothPage.close();

  expect(gutterhub.pageErrors, 'no uncaught page errors').toEqual([]);
});

test('pull request diff', async ({ gutterhub }) => {
  test.skip(PR_URL === '', 'set GUTTERHUB_E2E_PR to a pull request files URL to run this');

  await gutterhub.seed([coverage()]);
  const page = await gutterhub.open(PR_URL);
  const diff = await page.evaluate(() => {
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

  expect(diff.total, 'marks were drawn on a live pull request diff').toBeGreaterThan(0);
  expect(diff.total, 'every new-file line is marked').toBe(diff.rightCells);
  expect(diff.allOnRight, 'marks land on the new-file column').toBe(true);
  expect(diff.deletionsMarked, 'deletion rows are left alone').toBe(0);
  expect(new Set(diff.numbers).size, 'each diff line is marked exactly once').toBe(
    diff.numbers.length,
  );
  expect(diff.badge, 'the file header shows a badge').toMatch(/% covered/);
  expect(gutterhub.pageErrors, 'no uncaught page errors').toEqual([]);
});
