// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectFileBlocks } from '../src/github/adapters/index.js';
import { parseLocation } from '../src/github/location.js';
import { clearBlock, renderBlock, type MarkLayer } from '../src/github/render.js';
import type { LineMark, MarkStatus } from '../src/core/marks.js';
import { coverageMarks } from '../src/core/coverage.js';
import { parseLcov } from '../src/core/parsers/lcov.js';
import { LEGACY_BLOB, LEGACY_UNIFIED_DIFF } from './fixtures/github-markup.js';

const BLOB_CONTEXT = parseLocation('https://github.com/acme/widget/blob/main/src/calculator.ts')!;
const PR_CONTEXT = parseLocation('https://github.com/acme/widget/pull/42/files')!;

const OPTIONS = { highlightLines: true };

/** Wraps a mark map as the single layer most of these tests use. */
function layer(marks: Map<number, LineMark>, title = 'Code coverage'): MarkLayer[] {
  return [{ title, marks }];
}

/** Builds the marks the renderer consumes, from an LCOV snippet. */
function marks(lcov: string, showPartial = true): Map<number, LineMark> {
  return coverageMarks(parseLcov(lcov).files[0]!, { showPartial });
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

    renderBlock(block, layer(marks('SF:a.ts\nDA:1,3\nDA:2,0\nend_of_record\n')), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-good')).toBe(true);
    expect(block.lines[1]!.gutter.classList.contains('gutterhub-bad')).toBe(true);
  });

  it('leaves lines with no mark untouched', () => {
    // Coverage tools only instrument executable lines. Painting blank lines, comments and
    // closing braces red would be actively misleading.
    const block = blobBlock();

    const stats = renderBlock(
      block,
      layer(marks('SF:a.ts\nDA:1,1\nDA:2,1\nend_of_record\n')),
      OPTIONS,
    );

    expect(block.lines[2]!.gutter.className).not.toMatch(/gutterhub/);
    expect(stats.unknown).toBe(1);
  });

  it('marks a partially covered line in its own state', () => {
    const block = blobBlock();

    renderBlock(
      block,
      layer(marks('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n')),
      OPTIONS,
    );

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-partial')).toBe(true);
  });

  it('renders whatever tooltip the mark carries', () => {
    const block = blobBlock();

    renderBlock(
      block,
      layer(new Map([[1, { line: 1, status: 'good', tooltip: 'anything' }]])),
      OPTIONS,
    );

    expect(block.lines[0]!.gutter.getAttribute('title')).toBe('anything');
  });

  it('tints the row only when line highlighting is on', () => {
    const block = blobBlock();

    renderBlock(block, layer(marks('SF:a.ts\nDA:1,1\nend_of_record\n')), { highlightLines: false });

    expect(block.lines[0]!.row.classList.contains('gutterhub-highlight')).toBe(false);
  });

  it('counts every category', () => {
    const block = blobBlock();

    const stats = renderBlock(
      block,
      layer(marks('SF:a.ts\nDA:1,1\nDA:2,0\nDA:3,5\nBRDA:3,0,0,5\nBRDA:3,0,1,-\nend_of_record\n')),
      OPTIONS,
    );

    expect(stats).toEqual({ annotated: 3, good: 1, partial: 1, bad: 1, conflicts: 0, unknown: 0 });
  });

  it('is idempotent, so repeated renders do not accumulate classes', () => {
    const block = blobBlock();
    const report = marks('SF:a.ts\nDA:1,1\nend_of_record\n');

    renderBlock(block, layer(report), OPTIONS);
    const first = block.lines[0]!.gutter.className;
    renderBlock(block, layer(report), OPTIONS);

    expect(block.lines[0]!.gutter.className).toBe(first);
  });

  it('repaints when a line changes state between renders', () => {
    const block = blobBlock();

    renderBlock(block, layer(marks('SF:a.ts\nDA:1,0\nend_of_record\n')), OPTIONS);
    renderBlock(block, layer(marks('SF:a.ts\nDA:1,9\nend_of_record\n')), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-good')).toBe(true);
  });

  it('annotates only the file it was given in a multi-file diff', () => {
    document.body.innerHTML = LEGACY_UNIFIED_DIFF;
    const [calculator, untested] = collectFileBlocks(document, PR_CONTEXT).blocks;

    renderBlock(
      calculator!,
      layer(marks('SF:a.ts\nDA:1,1\nDA:2,1\nDA:3,1\nend_of_record\n')),
      OPTIONS,
    );

    expect(calculator!.root.querySelectorAll('.gutterhub-gutter').length).toBe(3);
    expect(untested!.root.querySelectorAll('.gutterhub-gutter').length).toBe(0);
  });

  it('draws marks that did not come from coverage at all', () => {
    // The renderer is the seam: it understands marks, not coverage. A second kind of
    // annotation is a new producer, not a change here.
    const block = blobBlock();

    renderBlock(
      block,
      layer(
        new Map<number, LineMark>([
          [1, { line: 1, status: 'good', tooltip: 'Mutant killed' }],
          [2, { line: 2, status: 'bad', tooltip: 'Mutant survived' }],
        ]),
      ),
      OPTIONS,
    );

    expect(block.lines[0]!.gutter.getAttribute('title')).toBe('Mutant killed');
    expect(block.lines[1]!.gutter.classList.contains('gutterhub-bad')).toBe(true);
  });
});

describe('multiple layers', () => {
  /** Two reports over the same lines, as when coverage and mutation are both loaded. */
  function twoLayers(first: [number, MarkStatus][], second: [number, MarkStatus][]): MarkLayer[] {
    const build = (entries: [number, MarkStatus][], word: string) =>
      new Map<number, LineMark>(
        entries.map(([line, status]) => [line, { line, status, tooltip: `${word} ${status}` }]),
      );

    return [
      { title: 'Code coverage', marks: build(first, 'coverage') },
      { title: 'Mutation testing', marks: build(second, 'mutation') },
    ];
  }

  it('draws a channel for each report', () => {
    const block = blobBlock();

    renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-l1-good')).toBe(true);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-l2-bad')).toBe(true);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-dual')).toBe(true);
  });

  it('lets the worst status drive the primary colour', () => {
    // A line one report is happy with and another is not must not read as fine.
    const block = blobBlock();

    renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-bad')).toBe(true);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-good')).toBe(false);
  });

  it('flags a line where the reports disagree', () => {
    const block = blobBlock();

    const stats = renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);

    expect(stats.conflicts).toBe(1);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-conflict')).toBe(true);
  });

  it('does not flag agreement, however bad', () => {
    const block = blobBlock();

    const stats = renderBlock(block, twoLayers([[1, 'bad']], [[1, 'bad']]), OPTIONS);

    expect(stats.conflicts).toBe(0);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-conflict')).toBe(false);
  });

  it('does not flag a line only one report knows about', () => {
    // Absence of data is not disagreement.
    const block = blobBlock();

    const stats = renderBlock(block, twoLayers([[1, 'good']], []), OPTIONS);

    expect(stats.conflicts).toBe(0);
  });

  it('treats good against partial as a disagreement', () => {
    const block = blobBlock();

    expect(renderBlock(block, twoLayers([[1, 'good']], [[1, 'partial']]), OPTIONS).conflicts).toBe(
      1,
    );
  });

  it('labels each report in the tooltip', () => {
    const block = blobBlock();

    renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);
    const tooltip = block.lines[0]!.gutter.getAttribute('title')!;

    expect(tooltip).toContain('Code coverage: coverage good');
    expect(tooltip).toContain('Mutation testing: mutation bad');
  });

  it('leads the tooltip with the disagreement', () => {
    const block = blobBlock();

    renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);

    expect(block.lines[0]!.gutter.getAttribute('title')!.split('\n')[0]).toMatch(/disagree/i);
  });

  it('leaves the tooltip unadorned when only one report is loaded', () => {
    const block = blobBlock();

    renderBlock(block, layer(marks('SF:a.ts\nDA:1,1\nend_of_record\n')), OPTIONS);

    expect(block.lines[0]!.gutter.getAttribute('title')).not.toMatch(/Code coverage:/);
  });

  it('still marks a line present in only the second report', () => {
    const block = blobBlock();

    const stats = renderBlock(block, twoLayers([], [[2, 'bad']]), OPTIONS);

    expect(stats.annotated).toBe(1);
    expect(block.lines[1]!.gutter.classList.contains('gutterhub-l2-bad')).toBe(true);
  });

  it('repaints when only the second report changes', () => {
    // The stamp has to cover every layer, or a changed second report is ignored.
    const block = blobBlock();

    renderBlock(block, twoLayers([[1, 'good']], [[1, 'good']]), OPTIONS);
    renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);

    expect(block.lines[0]!.gutter.classList.contains('gutterhub-l2-bad')).toBe(true);
    expect(block.lines[0]!.gutter.classList.contains('gutterhub-l2-good')).toBe(false);
  });

  it('clears layer classes along with everything else', () => {
    const block = blobBlock();
    renderBlock(block, twoLayers([[1, 'good']], [[1, 'bad']]), OPTIONS);

    clearBlock(document);

    expect(document.querySelectorAll('[class*="gutterhub"]')).toHaveLength(0);
  });
});

describe('clearBlock', () => {
  it('removes every class and tooltip it added', () => {
    const block = blobBlock();
    renderBlock(block, layer(marks('SF:a.ts\nDA:1,1\nDA:2,0\nend_of_record\n')), OPTIONS);

    clearBlock(document);

    expect(document.querySelectorAll('[class*="gutterhub"]')).toHaveLength(0);
    expect(block.lines[0]!.gutter.getAttribute('title')).toBeNull();
  });

  it('is safe to call when nothing was rendered', () => {
    document.body.innerHTML = LEGACY_BLOB;

    expect(() => clearBlock(document)).not.toThrow();
  });
});
