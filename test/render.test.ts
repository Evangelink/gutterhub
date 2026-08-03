// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectFileBlocks } from '../src/github/adapters/index.js';
import { parseLocation } from '../src/github/location.js';
import { clearBlock, renderBlock } from '../src/github/render.js';
import { parseLcov } from '../src/core/parsers/lcov.js';
import type { FileCoverage } from '../src/core/model.js';
import { LEGACY_BLOB, LEGACY_UNIFIED_DIFF } from './fixtures/github-markup.js';

const BLOB_CONTEXT = parseLocation('https://github.com/acme/widget/blob/main/src/calculator.ts')!;
const PR_CONTEXT = parseLocation('https://github.com/acme/widget/pull/42/files')!;

const OPTIONS = { highlightLines: true, showPartial: true };

function coverage(lcov: string): FileCoverage {
  return parseLcov(lcov).files[0]!;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

function blobBlock() {
  document.body.innerHTML = LEGACY_BLOB;
  return collectFileBlocks(document, BLOB_CONTEXT).blocks[0]!;
}

describe('renderBlock', () => {
  it('marks covered and uncovered lines distinctly', () => {
    const block = blobBlock();

    renderBlock(block, coverage('SF:a.ts\nDA:1,3\nDA:2,0\nend_of_record\n'), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-covered')).toBe(true);
    expect(block.lines[1]!.gutter.classList.contains('gutterhub-uncovered')).toBe(true);
  });

  it('leaves lines the report never mentions untouched', () => {
    // Coverage tools only instrument executable lines. Painting blank lines, comments and
    // closing braces red would be actively misleading.
    const block = blobBlock();

    const stats = renderBlock(block, coverage('SF:a.ts\nDA:1,1\nDA:2,1\nend_of_record\n'), OPTIONS);

    expect(block.lines[2]!.gutter.className).not.toMatch(/gutterhub/);
    expect(stats.unknown).toBe(1);
  });

  it('marks a partially covered line in its own state', () => {
    const block = blobBlock();

    renderBlock(
      block,
      coverage('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n'),
      OPTIONS,
    );

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-partial')).toBe(true);
  });

  it('folds partial lines into covered when the option is off', () => {
    const block = blobBlock();

    renderBlock(block, coverage('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n'), {
      ...OPTIONS,
      showPartial: false,
    });

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-covered')).toBe(true);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-partial')).toBe(false);
  });

  it('describes hit counts in the tooltip', () => {
    const block = blobBlock();

    renderBlock(block, coverage('SF:a.ts\nDA:1,7\nend_of_record\n'), OPTIONS);

    expect(block.lines[0]!.gutter.getAttribute('title')).toContain('7 hits');
  });

  it('says "1 hit" rather than "1 hits"', () => {
    const block = blobBlock();

    renderBlock(block, coverage('SF:a.ts\nDA:1,1\nend_of_record\n'), OPTIONS);

    expect(block.lines[0]!.gutter.getAttribute('title')).toContain('1 hit');
    expect(block.lines[0]!.gutter.getAttribute('title')).not.toContain('1 hits');
  });

  it('reports branch counts in the tooltip', () => {
    const block = blobBlock();

    renderBlock(
      block,
      coverage('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n'),
      OPTIONS,
    );

    expect(block.lines[0]!.gutter.getAttribute('title')).toContain('1/2 branches');
  });

  it('tints the row only when line highlighting is on', () => {
    const block = blobBlock();

    renderBlock(block, coverage('SF:a.ts\nDA:1,1\nend_of_record\n'), {
      ...OPTIONS,
      highlightLines: false,
    });

    expect(block.lines[0]!.row.classList.contains('gutterhub-highlight')).toBe(false);
  });

  it('counts every category', () => {
    const block = blobBlock();

    const stats = renderBlock(
      block,
      coverage('SF:a.ts\nDA:1,1\nDA:2,0\nDA:3,5\nBRDA:3,0,0,5\nBRDA:3,0,1,-\nend_of_record\n'),
      OPTIONS,
    );

    expect(stats).toEqual({ annotated: 3, covered: 1, partial: 1, uncovered: 1, unknown: 0 });
  });

  it('is idempotent, so repeated renders do not accumulate classes', () => {
    const block = blobBlock();
    const report = coverage('SF:a.ts\nDA:1,1\nend_of_record\n');

    renderBlock(block, report, OPTIONS);
    const first = block.lines[0]!.gutter.className;
    renderBlock(block, report, OPTIONS);

    expect(block.lines[0]!.gutter.className).toBe(first);
  });

  it('repaints when a line changes state between renders', () => {
    const block = blobBlock();

    renderBlock(block, coverage('SF:a.ts\nDA:1,0\nend_of_record\n'), OPTIONS);
    renderBlock(block, coverage('SF:a.ts\nDA:1,9\nend_of_record\n'), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-covered')).toBe(true);
  });

  it('annotates only the file it was given in a multi-file diff', () => {
    document.body.innerHTML = LEGACY_UNIFIED_DIFF;
    const [calculator, untested] = collectFileBlocks(document, PR_CONTEXT).blocks;

    renderBlock(calculator!, coverage('SF:a.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n'), OPTIONS);

    expect(calculator!.root.querySelectorAll('.gutterhub-gutter').length).toBe(3);
    expect(untested!.root.querySelectorAll('.gutterhub-gutter').length).toBe(0);
  });
});

describe('clearBlock', () => {
  it('removes every class and tooltip it added', () => {
    const block = blobBlock();
    renderBlock(block, coverage('SF:a.ts\nDA:1,1\nDA:2,0\nend_of_record\n'), OPTIONS);

    clearBlock(document);

    expect(document.querySelectorAll('[class*="gutterhub"]')).toHaveLength(0);
    expect(block.lines[0]!.gutter.getAttribute('title')).toBeNull();
  });

  it('is safe to call when nothing was rendered', () => {
    document.body.innerHTML = LEGACY_BLOB;

    expect(() => clearBlock(document)).not.toThrow();
  });
});
