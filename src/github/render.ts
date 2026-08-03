import type { LineMark, MarkStatus } from '../core/marks.js';
import type { CodeLine, FileBlock } from './adapters/index.js';

/**
 * Draws marks onto the page.
 *
 * This layer knows nothing about coverage — it takes `LineMark`s and paints them. Adding
 * a second kind of annotation means writing a new producer of marks, not touching
 * anything here or in the DOM adapters.
 */

/** Marks a node as processed so re-renders after DOM mutations stay cheap. */
const STAMP_ATTRIBUTE = 'data-gutterhub';

const GUTTER_CLASS = 'gutterhub-gutter';
const ROW_CLASS = 'gutterhub-row';

const STATUS_CLASS: Record<MarkStatus, string> = {
  good: 'gutterhub-good',
  partial: 'gutterhub-partial',
  bad: 'gutterhub-bad',
};

const ALL_CLASSES = [
  GUTTER_CLASS,
  ROW_CLASS,
  'gutterhub-highlight',
  ...Object.values(STATUS_CLASS),
];

export interface RenderOptions {
  /** Tint the whole line, not just the gutter. */
  highlightLines: boolean;
}

export interface RenderStats {
  annotated: number;
  good: number;
  partial: number;
  bad: number;
  /** Lines present in the view but carrying no mark. */
  unknown: number;
}

function paint(line: CodeLine, mark: LineMark, options: RenderOptions): void {
  line.gutter.classList.add(GUTTER_CLASS, STATUS_CLASS[mark.status]);
  line.gutter.setAttribute('title', mark.tooltip);
  line.gutter.setAttribute(STAMP_ATTRIBUTE, mark.status);

  line.row.classList.add(ROW_CLASS, STATUS_CLASS[mark.status]);
  line.row.classList.toggle('gutterhub-highlight', options.highlightLines);
}

/** Removes every trace of the overlay from a subtree. */
export function clearBlock(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>(`[${STAMP_ATTRIBUTE}]`)) {
    element.removeAttribute(STAMP_ATTRIBUTE);
    element.removeAttribute('title');
    element.classList.remove(...ALL_CLASSES);
  }

  for (const element of root.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`)) {
    element.classList.remove(...ALL_CLASSES);
  }
}

/**
 * Paints one file block.
 *
 * Lines with no corresponding mark are left untouched rather than drawn in a "no data"
 * state: a fully painted file where some lines simply were not instrumented reads as a
 * problem with the code rather than an absence of information.
 */
export function renderBlock(
  block: FileBlock,
  marks: ReadonlyMap<number, LineMark>,
  options: RenderOptions,
): RenderStats {
  const stats: RenderStats = { annotated: 0, good: 0, partial: 0, bad: 0, unknown: 0 };

  for (const line of block.lines) {
    const mark = marks.get(line.number);
    if (!mark) {
      stats.unknown++;
      continue;
    }

    // Repainting an unchanged line churns the DOM on every mutation callback.
    if (line.gutter.getAttribute(STAMP_ATTRIBUTE) !== mark.status) {
      paint(line, mark, options);
    }

    stats.annotated++;
    stats[mark.status]++;
  }

  return stats;
}

export function emptyStats(): RenderStats {
  return { annotated: 0, good: 0, partial: 0, bad: 0, unknown: 0 };
}

export function addStats(a: RenderStats, b: RenderStats): RenderStats {
  return {
    annotated: a.annotated + b.annotated,
    good: a.good + b.good,
    partial: a.partial + b.partial,
    bad: a.bad + b.bad,
    unknown: a.unknown + b.unknown,
  };
}
