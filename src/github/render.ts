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
/** Two channels is the practical limit before the gutter stops being readable. */
const MAX_LAYERS = 2;

const STATUS_CLASS: Record<MarkStatus, string> = {
  good: 'gutterhub-good',
  partial: 'gutterhub-partial',
  bad: 'gutterhub-bad',
};

/** Per-channel classes, so several reports can be drawn side by side. */
function layerClass(index: number, status: MarkStatus): string {
  return `gutterhub-l${index + 1}-${status}`;
}

const ALL_CLASSES = [
  GUTTER_CLASS,
  ROW_CLASS,
  'gutterhub-highlight',
  'gutterhub-dual',
  'gutterhub-conflict',
  ...Object.values(STATUS_CLASS),
  ...[0, 1].flatMap((index) =>
    (['good', 'partial', 'bad'] as MarkStatus[]).map((status) => layerClass(index, status)),
  ),
];

export interface MarkLayer {
  /** How this report names itself in tooltips, e.g. `Code coverage`. */
  title: string;
  marks: ReadonlyMap<number, LineMark>;
}

export interface RenderOptions {
  /** Tint the whole line, not just the gutter. */
  highlightLines: boolean;
}

export interface RenderStats {
  annotated: number;
  good: number;
  partial: number;
  bad: number;
  /**
   * Lines where the reports disagree — one rates the line good and another does not.
   * With coverage and mutation testing loaded together this is the headline number:
   * code that looks tested and is not.
   */
  conflicts: number;
  /** Lines present in the view but carrying no mark. */
  unknown: number;
}

/**
 * Combines the marks for one line across every layer.
 *
 * The worst status wins the primary colour, because a line that one report is happy with
 * and another is not should not read as fine at a glance.
 */
function combine(marks: (LineMark | undefined)[]): {
  status: MarkStatus;
  conflict: boolean;
} {
  const present = marks.filter((mark): mark is LineMark => mark !== undefined);
  const worst = present.some((mark) => mark.status === 'bad')
    ? 'bad'
    : present.some((mark) => mark.status === 'partial')
      ? 'partial'
      : 'good';

  const best = present.some((mark) => mark.status === 'good');

  return { status: worst, conflict: present.length > 1 && best && worst !== 'good' };
}

function composeTooltip(
  layers: readonly MarkLayer[],
  marks: (LineMark | undefined)[],
  conflict: boolean,
): string {
  if (layers.length === 1) {
    return marks[0]?.tooltip ?? '';
  }

  const lines = layers
    .map((layer, index) => (marks[index] ? `${layer.title}: ${marks[index]!.tooltip}` : null))
    .filter((line): line is string => line !== null);

  if (conflict) {
    // Stated plainly and first: this is the finding worth acting on.
    lines.unshift('⚠ Reports disagree — one rates this line good, another does not.');
  }

  return lines.join('\n');
}

/** Classes that describe the current state, and so must be cleared before repainting. */
const STATE_CLASSES = [
  'gutterhub-dual',
  'gutterhub-conflict',
  ...Object.values(STATUS_CLASS),
  ...[0, 1].flatMap((index) =>
    (['good', 'partial', 'bad'] as MarkStatus[]).map((status) => layerClass(index, status)),
  ),
];

function paint(
  line: CodeLine,
  marks: (LineMark | undefined)[],
  combined: { status: MarkStatus; conflict: boolean },
  tooltip: string,
  options: RenderOptions,
): void {
  // Repainting only ever added classes before, which left a stale colour behind when a
  // line changed state — visible only when two reports were loaded and one of them moved.
  line.gutter.classList.remove(...STATE_CLASSES);
  line.row.classList.remove(...STATE_CLASSES);

  line.gutter.classList.add(GUTTER_CLASS, STATUS_CLASS[combined.status]);
  line.gutter.classList.toggle('gutterhub-dual', marks.length > 1);
  line.gutter.classList.toggle('gutterhub-conflict', combined.conflict);

  marks.forEach((mark, index) => {
    if (mark) {
      line.gutter.classList.add(layerClass(index, mark.status));
    }
  });

  line.gutter.setAttribute('title', tooltip);
  line.gutter.setAttribute(STAMP_ATTRIBUTE, stamp(marks, combined));

  line.row.classList.add(ROW_CLASS, STATUS_CLASS[combined.status]);
  line.row.classList.toggle('gutterhub-highlight', options.highlightLines);
}

/** Identity of what is currently painted, so an unchanged line is not repainted. */
function stamp(marks: (LineMark | undefined)[], combined: { status: MarkStatus }): string {
  return `${combined.status}:${marks.map((mark) => mark?.status ?? '-').join(',')}`;
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
 * Paints one file block from one or more layers of marks.
 *
 * Lines with no corresponding mark are left untouched rather than drawn in a "no data"
 * state: a fully painted file where some lines simply were not instrumented reads as a
 * problem with the code rather than an absence of information.
 */
export function renderBlock(
  block: FileBlock,
  layers: readonly MarkLayer[],
  options: RenderOptions,
): RenderStats {
  const stats: RenderStats = {
    annotated: 0,
    good: 0,
    partial: 0,
    bad: 0,
    conflicts: 0,
    unknown: 0,
  };

  const used = layers.slice(0, MAX_LAYERS);

  for (const line of block.lines) {
    const marks = used.map((layer) => layer.marks.get(line.number));
    if (marks.every((mark) => mark === undefined)) {
      stats.unknown++;
      continue;
    }

    const combined = combine(marks);

    // Repainting an unchanged line churns the DOM on every mutation callback.
    if (line.gutter.getAttribute(STAMP_ATTRIBUTE) !== stamp(marks, combined)) {
      paint(line, marks, combined, composeTooltip(used, marks, combined.conflict), options);
    }

    stats.annotated++;
    stats[combined.status]++;
    if (combined.conflict) {
      stats.conflicts++;
    }
  }

  return stats;
}

export function emptyStats(): RenderStats {
  return { annotated: 0, good: 0, partial: 0, bad: 0, conflicts: 0, unknown: 0 };
}

export function addStats(a: RenderStats, b: RenderStats): RenderStats {
  return {
    annotated: a.annotated + b.annotated,
    good: a.good + b.good,
    partial: a.partial + b.partial,
    bad: a.bad + b.bad,
    conflicts: a.conflicts + b.conflicts,
    unknown: a.unknown + b.unknown,
  };
}
