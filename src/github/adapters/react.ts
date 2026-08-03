import {
  pathFromElement,
  parseLineNumber,
  type CodeLine,
  type DomAdapter,
  type FileBlock,
} from './types.js';

/**
 * React-rendered file and diff views.
 *
 * These emit `div`s rather than tables, but they keep a `data-line-number` attribute (or
 * an `L<n>` / `LC<n>` id) on the line-number element. Rows are located by walking up from
 * the number to the nearest element that also contains the code text, which survives
 * class-name churn far better than matching on the class names themselves.
 */
export const reactViewAdapter: DomAdapter = {
  id: 'react-view',

  collect(root: ParentNode): FileBlock[] {
    const containers = [
      ...root.querySelectorAll<HTMLElement>(
        '[data-testid="code-view"], .react-code-view, [data-selector="diff-file"], .diff-view',
      ),
    ];

    // Fall back to a single implicit container so a lone file view still renders.
    const roots: HTMLElement[] =
      containers.length > 0 ? containers : root instanceof HTMLElement ? [root] : [document.body];

    const blocks: FileBlock[] = [];

    for (const container of roots) {
      const lines = collectReactLines(container);
      if (lines.length > 0) {
        blocks.push({ path: pathFromElement(container), root: container, lines });
      }
    }

    return blocks;
  },
};

function collectReactLines(container: HTMLElement): CodeLine[] {
  const seen = new Set<HTMLElement>();
  const lines: CodeLine[] = [];

  for (const element of container.querySelectorAll<HTMLElement>(
    '[data-line-number], [data-grid-cell-id*="line-number"], .react-line-number, .react-code-text-cell',
  )) {
    if (element.tagName === 'TD') {
      // Table markup is the legacy adapter's job; claiming it here would double-render.
      continue;
    }

    const number =
      parseLineNumber(element.getAttribute('data-line-number')) ??
      parseLineNumber(element.id.replace(/^LC?/, '')) ??
      parseLineNumber(element.textContent);

    if (number === null || seen.has(element)) {
      continue;
    }
    seen.add(element);

    lines.push({ number, gutter: element, row: rowOf(element) });
  }

  return lines;
}

/**
 * Finds the element representing the whole line. Climbs until the ancestor holds
 * meaningfully more text than the line number alone, which indicates it also wraps the
 * source code, then stops before swallowing the entire file.
 */
function rowOf(gutter: HTMLElement): HTMLElement {
  const numberLength = (gutter.textContent ?? '').trim().length;
  let candidate: HTMLElement = gutter;

  for (let depth = 0; depth < 4; depth++) {
    const parent = candidate.parentElement;
    if (!parent) {
      break;
    }

    candidate = parent;
    const text = (candidate.textContent ?? '').trim();
    if (text.length > numberLength + 1) {
      return candidate;
    }
  }

  return candidate;
}
