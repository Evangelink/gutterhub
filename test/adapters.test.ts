// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectFileBlocks } from '../src/github/adapters/index.js';
import { parseLocation } from '../src/github/location.js';
import {
  LEGACY_BLOB,
  LEGACY_UNIFIED_DIFF,
  REACT_BLOB,
  REACT_BLOB_PAIRED_ROWS,
  UNKNOWN_FUTURE_MARKUP,
} from './fixtures/github-markup.js';

const PR_CONTEXT = parseLocation('https://github.com/acme/widget/pull/42/files')!;
const BLOB_CONTEXT = parseLocation('https://github.com/acme/widget/blob/main/src/calculator.ts')!;

function mount(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('legacy unified diff', () => {
  it('finds one block per file', () => {
    mount(LEGACY_UNIFIED_DIFF);

    const { adapterId, blocks } = collectFileBlocks(document, PR_CONTEXT);

    expect(adapterId).toBe('legacy-diff');
    expect(blocks.map((block) => block.path)).toEqual(['src/calculator.ts', 'src/untested.ts']);
  });

  it('reads new-file line numbers, not old-file ones', () => {
    mount(LEGACY_UNIFIED_DIFF);

    const [calculator] = collectFileBlocks(document, PR_CONTEXT).blocks;

    expect(calculator!.lines.map((line) => line.number)).toEqual([1, 2, 3]);
  });

  it('skips deletion rows, whose lines no longer exist', () => {
    mount(LEGACY_UNIFIED_DIFF);

    const [calculator] = collectFileBlocks(document, PR_CONTEXT).blocks;
    const codeTexts = calculator!.lines.map((line) =>
      line.row.querySelector('.blob-code')?.textContent?.trim(),
    );

    expect(codeTexts).not.toContain('return a - b;');
    expect(codeTexts).toContain('return a + b;');
  });

  it('ignores hunk header rows', () => {
    mount(LEGACY_UNIFIED_DIFF);

    const [calculator] = collectFileBlocks(document, PR_CONTEXT).blocks;

    expect(calculator!.lines).toHaveLength(3);
  });

  it('points the gutter at the line-number cell', () => {
    mount(LEGACY_UNIFIED_DIFF);

    const [calculator] = collectFileBlocks(document, PR_CONTEXT).blocks;

    expect(calculator!.lines[0]!.gutter.tagName).toBe('TD');
    expect(calculator!.lines[0]!.gutter.classList.contains('blob-num')).toBe(true);
  });
});

describe('legacy blob view', () => {
  it('collects every line', () => {
    mount(LEGACY_BLOB);

    const { adapterId, blocks } = collectFileBlocks(document, BLOB_CONTEXT);

    expect(adapterId).toBe('legacy-blob');
    expect(blocks[0]!.lines.map((line) => line.number)).toEqual([1, 2, 3]);
  });

  it('takes the path from the DOM when present', () => {
    mount(LEGACY_BLOB);

    expect(collectFileBlocks(document, BLOB_CONTEXT).blocks[0]!.path).toBe('src/calculator.ts');
  });

  it('falls back to the URL path when the DOM has none', () => {
    mount(LEGACY_BLOB.replace(' data-tagsearch-path="src/calculator.ts"', ''));

    expect(collectFileBlocks(document, BLOB_CONTEXT).blocks[0]!.path).toBe('src/calculator.ts');
  });
});

describe('react view', () => {
  it('collects each line exactly once despite the duplicated attribute', () => {
    // Numbers and code sit in separate columns and both carry `data-line-number`.
    // Collecting them naively annotates every line twice.
    mount(REACT_BLOB);

    const { adapterId, blocks } = collectFileBlocks(document, BLOB_CONTEXT);

    expect(adapterId).toBe('react-view');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.lines.map((line) => line.number)).toEqual([1, 2, 3]);
  });

  it('puts the marker on the number column and the tint on the code', () => {
    mount(REACT_BLOB);

    const [line] = collectFileBlocks(document, BLOB_CONTEXT).blocks[0]!.lines;

    expect(line!.gutter.classList.contains('react-line-number')).toBe(true);
    expect(line!.row.classList.contains('react-file-line')).toBe(true);
    expect(line!.row.textContent).toContain('export function add');
  });

  it('takes the path from the URL, as the page carries none', () => {
    mount(REACT_BLOB);

    expect(collectFileBlocks(document, BLOB_CONTEXT).blocks[0]!.path).toBe('src/calculator.ts');
  });

  it('also handles a layout where number and code share one row', () => {
    mount(REACT_BLOB_PAIRED_ROWS);

    const { blocks } = collectFileBlocks(document, BLOB_CONTEXT);

    expect(blocks[0]!.lines.map((line) => line.number)).toEqual([1, 2, 3]);
    expect(blocks[0]!.lines[0]!.row.textContent).toContain('export function add');
  });

  it('keeps files apart when several are on the page', () => {
    mount(`
      <div data-path="src/a.ts">
        <div class="react-line-number" data-line-number="1">1</div>
        <div class="react-file-line" data-line-number="1">const a = 1;</div>
      </div>
      <div data-path="src/b.ts">
        <div class="react-line-number" data-line-number="1">1</div>
        <div class="react-file-line" data-line-number="1">const b = 2;</div>
      </div>
    `);

    const { blocks } = collectFileBlocks(document, BLOB_CONTEXT);

    expect(blocks.map((block) => block.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('does not merge files under a shared wrapper', () => {
    // Keeping an outer container would collapse every file into one block and lose
    // the per-file paths.
    mount(`
      <div data-path="ignored-wrapper">
        <div data-path="src/a.ts">
          <div class="react-line-number" data-line-number="1">1</div>
          <div class="react-file-line" data-line-number="1">const a = 1;</div>
        </div>
        <div data-path="src/b.ts">
          <div class="react-line-number" data-line-number="1">1</div>
          <div class="react-file-line" data-line-number="1">const b = 2;</div>
        </div>
      </div>
    `);

    expect(collectFileBlocks(document, BLOB_CONTEXT).blocks.map((block) => block.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });
});

describe('resilience to markup changes', () => {
  it('still finds lines in a layout no adapter was written for', () => {
    // This is the failure mode that killed earlier coverage extensions: GitHub changes
    // its markup and the overlay silently stops working.
    mount(UNKNOWN_FUTURE_MARKUP);

    const { blocks } = collectFileBlocks(document, BLOB_CONTEXT);

    expect(blocks[0]!.lines.map((line) => line.number)).toEqual([1, 2]);
    expect(blocks[0]!.path).toBe('src/calculator.ts');
  });

  it('returns nothing rather than throwing on an unrelated page', () => {
    mount('<div class="application-main"><h1>Some other page</h1></div>');

    expect(collectFileBlocks(document, BLOB_CONTEXT).blocks).toEqual([]);
  });

  it('returns nothing for an empty document', () => {
    expect(collectFileBlocks(document, BLOB_CONTEXT).blocks).toEqual([]);
  });
});
