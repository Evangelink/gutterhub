/**
 * Deterministic, offline end-to-end suite — the PR gate.
 *
 * Every github.com page is served from saved markup and all real network is blocked, so
 * these tests never touch github.com (asserted explicitly) and never flake on GitHub being
 * slow or changing its markup. They cover the same intent as the live canary — every line
 * marked once, diffs marking only the new-file column, absolute CI paths resolving, and the
 * two-report overlay/disagreement behaviour — plus the popup and options pages.
 */

import { REPOSITORY, readMarks, test, expect } from './fixtures/extension.js';
import { coverageReport, mutationReport } from './fixtures/reports.js';
import { DIFF_NEW_FILE_LINES, diffPage, reactBlobPage } from './fixtures/markup.js';

const BLOB_URL = `https://github.com/${REPOSITORY}/blob/main/src/calculator.ts`;
const COMMIT_URL = `https://github.com/${REPOSITORY}/commit/${'a'.repeat(40)}`;
const OPTIONS = (id: string) => `chrome-extension://${id}/options.html`;
const POPUP = (id: string) => `chrome-extension://${id}/popup.html`;

/** The blob fixture renders this many lines; the coverage report covers every one. */
const BLOB_LINES = 12;
/** The mutation report mentions fewer lines than the coverage report. */
const MUTATION_LINES = 8;

const coverage = () => coverageReport({ path: 'src/calculator.ts', lines: BLOB_LINES });
const mutation = () => mutationReport({ path: 'src/calculator.ts', lines: MUTATION_LINES });

test.describe('coverage report, file view', () => {
  test('paints one mark per line and resolves an absolute CI path', async ({ gutterhub }) => {
    gutterhub.serve(BLOB_URL, reactBlobPage(BLOB_LINES));
    expect(await gutterhub.seed([coverage()])).toBe(1);

    const page = await gutterhub.open(BLOB_URL);
    const marks = await readMarks(page);

    expect(marks.total, 'marks were drawn on the file view').toBeGreaterThan(0);
    expect(marks.total, 'an absolute CI path resolved to the repository path').toBe(
      marks.renderedLines,
    );
    expect(new Set(marks.numbers).size, 'each line is marked exactly once').toBe(
      marks.numbers.length,
    );
    expect(marks.good, 'covered lines are green').toBeGreaterThan(0);
    expect(marks.bad, 'uncovered lines are red').toBeGreaterThan(0);
    expect(marks.partial, 'a branch-partial line is amber').toBeGreaterThan(0);
    expect(marks.tooltip, 'tooltips carry the hit count').toMatch(/hit/);
    expect(marks.tinted, 'rows are tinted').toBeGreaterThan(0);

    expect(gutterhub.leaks, 'no request reached github.com').toEqual([]);
    expect(gutterhub.pageErrors).toEqual([]);
  });
});

test.describe('mutation report, file view', () => {
  test('lights up the same pipeline with a different report kind', async ({ gutterhub }) => {
    gutterhub.serve(BLOB_URL, reactBlobPage(BLOB_LINES));

    await gutterhub.seed([coverage()]);
    const coveragePage = await gutterhub.open(BLOB_URL);
    const coverageMarks = await readMarks(coveragePage);
    await coveragePage.close();

    await gutterhub.seed([mutation()]);
    const page = await gutterhub.open(BLOB_URL);
    const marks = await readMarks(page);

    expect(marks.total, 'a mutation report also draws marks').toBeGreaterThan(0);
    expect(marks.good, 'killed mutants are green').toBeGreaterThan(0);
    expect(marks.bad, 'surviving mutants are red').toBeGreaterThan(0);
    expect(marks.partial, 'a line with killed and surviving mutants is amber').toBeGreaterThan(0);
    expect(marks.tooltip, 'tooltips speak mutation, not coverage').toMatch(/mutants killed/);
    expect(new Set(marks.numbers).size, 'each line is marked exactly once').toBe(
      marks.numbers.length,
    );
    expect(marks.total, 'the mutation report marks only the lines it mentions').toBeLessThan(
      coverageMarks.total,
    );

    expect(gutterhub.leaks).toEqual([]);
    expect(gutterhub.pageErrors).toEqual([]);
  });
});

test.describe('coverage + mutation together, file view', () => {
  test('overlays both reports and flags where they disagree', async ({ gutterhub }) => {
    gutterhub.serve(BLOB_URL, reactBlobPage(BLOB_LINES));
    expect(await gutterhub.seed([coverage(), mutation()])).toBe(2);

    const page = await gutterhub.open(BLOB_URL);
    const both = await page.evaluate(() => ({
      total: document.querySelectorAll('.gutterhub-gutter').length,
      dual: document.querySelectorAll('.gutterhub-gutter.gutterhub-dual').length,
      l1: document.querySelectorAll('[class*="gutterhub-l1-"]').length,
      l2: document.querySelectorAll('[class*="gutterhub-l2-"]').length,
      conflicts: document.querySelectorAll('.gutterhub-conflict').length,
      conflictTooltip: document.querySelector('.gutterhub-conflict')?.getAttribute('title') ?? '',
    }));

    expect(both.total, 'both reports render together').toBeGreaterThan(0);
    expect(both.dual, 'lines carry two channels').toBeGreaterThan(0);
    expect(both.l1, 'channel 1 is drawn').toBeGreaterThan(0);
    expect(both.l2, 'channel 2 is drawn').toBeGreaterThan(0);
    expect(both.conflicts, 'lines where the reports disagree are flagged').toBeGreaterThan(0);
    expect(both.conflictTooltip, 'the disagreement leads the tooltip').toMatch(/disagree/i);
    expect(both.conflictTooltip, 'the tooltip names the coverage report').toMatch(/Code coverage:/);
    expect(both.conflictTooltip, 'the tooltip names the mutation report').toMatch(
      /Mutation testing:/,
    );

    // Sanity-check the service-worker status route as well.
    const status = (await gutterhub.overlayStatus()) as { state?: string; conflicts?: number };
    expect(status?.state).toBe('ready');
    expect(status?.conflicts ?? 0).toBeGreaterThan(0);

    expect(gutterhub.leaks).toEqual([]);
    expect(gutterhub.pageErrors).toEqual([]);
  });
});

test.describe('coverage report, diff view', () => {
  test('marks only the new-file column and never deletion rows', async ({ gutterhub }) => {
    // A commit page is a diff whose head SHA is in the URL, so no api.github.com call is
    // needed to resolve it — keeping the test genuinely offline.
    gutterhub.serve(COMMIT_URL, diffPage());
    await gutterhub.seed([
      coverageReport({ path: 'src/calculator.ts', lines: DIFF_NEW_FILE_LINES }),
    ]);

    const page = await gutterhub.open(COMMIT_URL);
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

    expect(diff.total, 'marks were drawn on the diff').toBeGreaterThan(0);
    expect(diff.total, 'every new-file line is marked').toBe(diff.rightCells);
    expect(diff.allOnRight, 'marks land on the new-file column').toBe(true);
    expect(diff.deletionsMarked, 'deletion rows are left alone').toBe(0);
    expect(new Set(diff.numbers).size, 'each diff line is marked exactly once').toBe(
      diff.numbers.length,
    );
    expect(diff.badge, 'the file header shows a badge').toMatch(/% covered/);

    expect(gutterhub.leaks).toEqual([]);
    expect(gutterhub.pageErrors).toEqual([]);
  });
});

test.describe('popup', () => {
  /**
   * The popup reads the active tab's status. Opening it as a tab would make it the active
   * tab, so the github page is brought to front and the popup reloaded, which re-runs its
   * initialiser with the github page active — the shape a real action popup sees.
   */
  async function openPopup(
    gutterhub: import('./fixtures/extension.js').GutterHub,
    behind: import('@playwright/test').Page,
  ) {
    const popup = await gutterhub.context.newPage();
    await popup.goto(POPUP(gutterhub.extensionId));
    await behind.bringToFront();
    await popup.reload();
    await popup.waitForFunction(() => !document.getElementById('setup')?.hidden);
    return popup;
  }

  test('shows two sources, neutral legend, and the conflict count', async ({ gutterhub }) => {
    gutterhub.serve(BLOB_URL, reactBlobPage(BLOB_LINES));
    await gutterhub.seed([coverage(), mutation()]);
    const blob = await gutterhub.open(BLOB_URL);

    const popup = await openPopup(gutterhub, blob);
    await popup.waitForFunction(() =>
      (document.getElementById('status-source')?.textContent ?? '').includes('Mutation testing'),
    );

    const view = await popup.evaluate(() => ({
      secondEnabled: (document.getElementById('second-enabled') as HTMLInputElement).checked,
      source: document.getElementById('status-source')?.textContent ?? '',
      legendGood: document.getElementById('legend-good')?.textContent ?? '',
      legendBad: document.getElementById('legend-bad')?.textContent ?? '',
      conflictsHidden: (document.getElementById('conflicts') as HTMLElement).hidden,
      conflicts: document.getElementById('conflicts')?.textContent ?? '',
      warningsHidden: (document.getElementById('warnings') as HTMLElement).hidden,
    }));

    expect(view.secondEnabled, 'the second report is configured').toBe(true);
    expect(view.source, 'both report kinds are named').toContain('Code coverage');
    expect(view.source).toContain('Mutation testing');
    // Two report kinds: the legend falls back to neutral words rather than one kind's.
    expect(view.legendGood).toBe('good');
    expect(view.legendBad).toBe('needs tests');
    expect(view.conflictsHidden, 'the conflict banner is shown').toBe(false);
    expect(view.conflicts).toMatch(/disagree/);
    expect(view.warningsHidden, 'no warnings for two good reports').toBe(true);

    expect(gutterhub.leaks).toEqual([]);
  });

  test('uses the report kind for the legend when a single report is loaded', async ({
    gutterhub,
  }) => {
    gutterhub.serve(BLOB_URL, reactBlobPage(BLOB_LINES));
    await gutterhub.seed([coverage()]);
    const blob = await gutterhub.open(BLOB_URL);

    const popup = await openPopup(gutterhub, blob);
    await popup.waitForFunction(
      () => document.getElementById('legend-good')?.textContent === 'covered',
    );

    const legend = await popup.evaluate(() => ({
      good: document.getElementById('legend-good')?.textContent ?? '',
      partial: document.getElementById('legend-partial')?.textContent ?? '',
      bad: document.getElementById('legend-bad')?.textContent ?? '',
      secondEnabled: (document.getElementById('second-enabled') as HTMLInputElement).checked,
    }));

    expect(legend.good, 'coverage vocabulary').toBe('covered');
    expect(legend.partial).toBe('partial');
    expect(legend.bad).toBe('uncovered');
    expect(legend.secondEnabled, 'only one source configured').toBe(false);
  });

  test('surfaces a warning when a configured source has no report', async ({ gutterhub }) => {
    gutterhub.serve(BLOB_URL, reactBlobPage(BLOB_LINES));
    // First source has a report; the second slot is configured but never uploaded.
    await gutterhub.seed([coverage()], { missingSlots: ['s1'] });
    const blob = await gutterhub.open(BLOB_URL);

    const popup = await openPopup(gutterhub, blob);
    await popup.waitForFunction(() => !(document.getElementById('warnings') as HTMLElement).hidden);

    const warnings = await popup.evaluate(
      () => document.getElementById('warnings')?.textContent ?? '',
    );
    expect(warnings.length, 'a warning is shown').toBeGreaterThan(0);
    expect(warnings).toMatch(/manual/i);
  });
});

test.describe('options', () => {
  test('renders configured repositories and round-trips a path mapping', async ({ gutterhub }) => {
    await gutterhub.seed([coverage(), mutation()]);

    const options = await gutterhub.context.newPage();
    await options.goto(OPTIONS(gutterhub.extensionId));
    await options.waitForFunction(() => document.querySelectorAll('.repo-row').length > 0);

    const view = await options.evaluate(() => ({
      enabled: (document.getElementById('enabled') as HTMLInputElement).checked,
      highlight: (document.getElementById('highlight-lines') as HTMLInputElement).checked,
      partial: (document.getElementById('show-partial') as HTMLInputElement).checked,
      rows: document.querySelectorAll('.repo-row').length,
      repoName: document.querySelector('.repo-row strong')?.textContent ?? '',
      sourceHint: document.querySelector('.repo-row .hint')?.textContent ?? '',
      pathOptions: document.querySelectorAll('#path-repo option').length,
    }));

    expect(view.enabled).toBe(true);
    expect(view.highlight).toBe(true);
    expect(view.partial).toBe(true);
    expect(view.rows, 'one configured repository').toBe(1);
    expect(view.repoName).toBe(REPOSITORY);
    // describeSource joins the two sources — proof both are shown per kind.
    expect(view.sourceHint, 'both sources are described').toContain(' + ');
    expect(view.pathOptions, 'the path-mapping picker lists the repository').toBe(1);

    // Set a path mapping, save, reload, and confirm it survived a storage round-trip.
    await options.fill('#strip-prefix', 'packages/app');
    await options.dispatchEvent('#strip-prefix', 'change');
    await options.click('#save');
    await options.waitForFunction(() => document.getElementById('saved')?.textContent === 'Saved.');

    await options.reload();
    await options.waitForFunction(() => document.querySelectorAll('.repo-row').length > 0);
    const persisted = await options.evaluate(
      () => (document.getElementById('strip-prefix') as HTMLInputElement).value,
    );
    expect(persisted, 'the path mapping persisted').toBe('packages/app');
  });

  test('removing a repository clears it from the list', async ({ gutterhub }) => {
    await gutterhub.seed([coverage()]);

    const options = await gutterhub.context.newPage();
    await options.goto(OPTIONS(gutterhub.extensionId));
    await options.waitForFunction(() => document.querySelectorAll('.repo-row').length > 0);

    await options.click('.repo-row button');
    await options.waitForFunction(() => document.querySelectorAll('.repo-row').length === 0);

    const emptyShown = await options.evaluate(
      () => !(document.getElementById('repo-empty') as HTMLElement).hidden,
    );
    expect(emptyShown, 'the empty-state message is shown').toBe(true);
  });
});
