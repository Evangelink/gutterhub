/** Ad-hoc DOM probe against a live GitHub page, used while developing the adapters. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url =
  process.argv[2] ?? 'https://github.com/Evangelink/gutterhub/blob/main/src/core/model.ts';
const profile = mkdtempSync(join(tmpdir(), 'gutterhub-probe-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
});

try {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('[data-line-number]')];

    const byClass = {};
    for (const element of elements) {
      const key = element.className?.toString() ?? '(none)';
      byClass[key] = (byClass[key] ?? 0) + 1;
    }

    const duplicates = {};
    for (const element of elements) {
      const n = element.getAttribute('data-line-number');
      (duplicates[n] ??= []).push({
        tag: element.tagName,
        cls: element.className?.toString(),
        parent: element.parentElement?.className?.toString(),
        text: (element.textContent ?? '').slice(0, 50),
        visible: element.getClientRects().length > 0,
      });
    }

    const pathCarriers = [
      'data-tagsearch-path',
      'data-path',
      'data-file-path',
      'data-file-name',
    ].map((attribute) => ({
      attribute,
      count: document.querySelectorAll(`[${attribute}]`).length,
      first: document.querySelector(`[${attribute}]`)?.getAttribute(attribute) ?? null,
    }));

    return {
      total: elements.length,
      byClass,
      lineOne: duplicates['1'],
      lineFive: duplicates['5'],
      pathCarriers,
      textarea: document.querySelector('#read-only-cursor-text-area') ? 'present' : 'absent',
    };
  });

  console.log(JSON.stringify(info, null, 2));
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
