import {
  pathFromElement,
  parseLineNumber,
  type CodeLine,
  type DomAdapter,
  type FileBlock,
} from './types.js';

/**
 * GitHub's long-standing table-based diff (`.file` → `table.diff-table` → `td.blob-num`).
 *
 * Each row carries up to two line-number cells: the old file on the left and the new
 * file on the right. Coverage always describes the new file, so the last numbered cell
 * in a row is the one that matters; rows whose last cell has no number are deletions and
 * are skipped, since those lines no longer exist to be covered.
 */
export const legacyDiffAdapter: DomAdapter = {
  id: 'legacy-diff',

  collect(root: ParentNode): FileBlock[] {
    const containers = root.querySelectorAll<HTMLElement>(
      '.file[data-tagsearch-path], .js-file[data-tagsearch-path], .file',
    );

    const blocks: FileBlock[] = [];

    for (const container of containers) {
      const table = container.querySelector('table.diff-table, table.js-diff-table');
      if (!table) {
        continue;
      }

      const lines: CodeLine[] = [];

      for (const row of table.querySelectorAll<HTMLElement>('tr')) {
        const numberCells = row.querySelectorAll<HTMLElement>('td.blob-num');
        const lastCell = numberCells[numberCells.length - 1];
        if (!lastCell) {
          continue;
        }

        // A deletion row's right-hand cell is blank: the line is gone from the new file.
        if (lastCell.classList.contains('blob-num-deletion')) {
          continue;
        }

        const number = parseLineNumber(
          lastCell.getAttribute('data-line-number') ?? lastCell.textContent,
        );
        if (number === null) {
          continue;
        }

        lines.push({ number, gutter: lastCell, row });
      }

      if (lines.length > 0) {
        blocks.push({ path: pathFromElement(container), root: container, lines });
      }
    }

    return blocks;
  },
};

/**
 * The classic single-file view: one table whose `td.blob-num` cells carry the line number.
 */
export const legacyBlobAdapter: DomAdapter = {
  id: 'legacy-blob',

  collect(root: ParentNode): FileBlock[] {
    const table = root.querySelector<HTMLElement>(
      'table.js-file-line-container, table.highlight.tab-size',
    );
    if (!table) {
      return [];
    }

    const lines: CodeLine[] = [];

    for (const cell of table.querySelectorAll<HTMLElement>('td.blob-num[data-line-number]')) {
      const number = parseLineNumber(cell.getAttribute('data-line-number'));
      if (number === null) {
        continue;
      }
      lines.push({ number, gutter: cell, row: cell.parentElement ?? cell });
    }

    return lines.length === 0 ? [] : [{ path: pathFromElement(table), root: table, lines }];
  },
};
