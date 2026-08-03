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
 * The modern code view lays a file out as two sibling columns: a `.react-line-numbers`
 * column of numbers and a column of `.react-file-line` code rows. Crucially **both**
 * carry `data-line-number`, so a naive `querySelectorAll('[data-line-number]')` returns
 * every line twice and annotates it twice.
 *
 * Elements are therefore classified as gutter or content and paired by line number, which
 * also puts the marker on the number column and row tinting on the code.
 */
export const reactViewAdapter: DomAdapter = {
  id: 'react-view',

  collect(root: ParentNode): FileBlock[] {
    const blocks: FileBlock[] = [];

    for (const container of containers(root)) {
      const lines = collectLines(container);
      if (lines.length > 0) {
        blocks.push({ path: pathFromElement(container), root: container, lines });
      }
    }

    return blocks;
  },
};

/**
 * Finds the elements that each wrap a single file.
 *
 * Only the innermost path-carrying elements are kept: an outer wrapper around every file
 * in a diff would merge them into one block and lose the per-file paths.
 */
function containers(root: ParentNode): HTMLElement[] {
  const candidates = [
    ...root.querySelectorAll<HTMLElement>(
      '[data-tagsearch-path], [data-path], [data-file-path], [data-selector="diff-file"]',
    ),
  ].filter((element) => element.querySelector('[data-line-number]') !== null);

  const innermost = candidates.filter(
    (element) => !candidates.some((other) => other !== element && element.contains(other)),
  );

  if (innermost.length > 0) {
    return innermost;
  }

  // Today's blob view carries no path attribute at all, so fall back to a single
  // implicit container; the caller supplies the path from the URL.
  const host = root instanceof HTMLElement ? root : document.body;
  return host ? [host] : [];
}

const GUTTER_SELECTOR = '.react-line-number, .react-code-line-number, [data-testid="line-number"]';

function collectLines(container: HTMLElement): CodeLine[] {
  const gutters = new Map<number, HTMLElement>();
  const rows = new Map<number, HTMLElement>();

  for (const element of container.querySelectorAll<HTMLElement>('[data-line-number]')) {
    // Table markup belongs to the legacy adapters; claiming it here would double-render.
    if (element.tagName === 'TD') {
      continue;
    }

    const number = parseLineNumber(element.getAttribute('data-line-number'));
    if (number === null) {
      continue;
    }

    const target = isGutter(element, number) ? gutters : rows;
    // Keep the first occurrence: later ones are wrapped continuations of the same line.
    if (!target.has(number)) {
      target.set(number, element);
    }
  }

  const lines: CodeLine[] = [];

  for (const number of new Set([...gutters.keys(), ...rows.keys()])) {
    const gutter = gutters.get(number) ?? rows.get(number);
    if (!gutter) {
      continue;
    }
    lines.push({ number, gutter, row: rows.get(number) ?? rowOf(gutter) });
  }

  return lines.sort((a, b) => a.number - b.number);
}

/**
 * Finds the element representing a whole line when the code carries no line number of
 * its own, as in layouts that put the number and the code in a single row.
 *
 * Climbs until the ancestor holds more than the line number alone. An ancestor covering
 * several lines is rejected, which is what stops the walk from swallowing the entire
 * line-number column — every number in it would then tint the whole file.
 */
function rowOf(gutter: HTMLElement): HTMLElement {
  const numberLength = (gutter.textContent ?? '').trim().length;
  let candidate: HTMLElement = gutter;

  for (let depth = 0; depth < 4; depth++) {
    const parent = candidate.parentElement;
    if (!parent || parent.querySelectorAll('[data-line-number]').length > 1) {
      break;
    }

    candidate = parent;
    if ((candidate.textContent ?? '').trim().length > numberLength + 1) {
      return candidate;
    }
  }

  return candidate;
}

/**
 * Distinguishes the line-number element from the code element.
 *
 * The class check handles the current markup; the text comparison is the durable part,
 * because an element whose entire content is the line number is a number cell whatever
 * it happens to be called.
 */
function isGutter(element: HTMLElement, number: number): boolean {
  if (element.matches(GUTTER_SELECTOR)) {
    return true;
  }

  return (element.textContent ?? '').trim() === String(number);
}
