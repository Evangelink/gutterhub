import { lineStatus, type FileCoverage, type LineStatus } from '../core/model.js';
import type { CodeLine, FileBlock } from './adapters/index.js';

/** Marks a node as processed so re-renders after DOM mutations stay cheap. */
const STAMP_ATTRIBUTE = 'data-gutterhub';

const GUTTER_CLASS = 'gutterhub-gutter';
const ROW_CLASS = 'gutterhub-row';

const STATUS_CLASS: Record<LineStatus, string> = {
  covered: 'gutterhub-covered',
  uncovered: 'gutterhub-uncovered',
  partial: 'gutterhub-partial',
};

const ALL_CLASSES = [
  GUTTER_CLASS,
  ROW_CLASS,
  'gutterhub-highlight',
  ...Object.values(STATUS_CLASS),
];

export interface RenderOptions {
  highlightLines: boolean;
  /** When false, partially covered lines are painted as covered. */
  showPartial: boolean;
}

export interface RenderStats {
  annotated: number;
  covered: number;
  partial: number;
  uncovered: number;
  /** Lines present in the view but absent from the report (comments, blank lines, …). */
  unknown: number;
}

function describe(status: LineStatus, hits: number | null, branches?: string): string {
  const base =
    status === 'covered'
      ? 'Covered by tests'
      : status === 'partial'
        ? 'Partially covered — some branches never taken'
        : 'Not covered by tests';

  const parts = [base];
  if (hits !== null) {
    parts.push(hits === 1 ? '1 hit' : `${hits} hits`);
  }
  if (branches) {
    parts.push(branches);
  }

  return parts.join(' · ');
}

function paint(line: CodeLine, status: LineStatus, title: string, options: RenderOptions): void {
  line.gutter.classList.add(GUTTER_CLASS, STATUS_CLASS[status]);
  line.gutter.setAttribute('title', title);
  line.gutter.setAttribute(STAMP_ATTRIBUTE, status);

  line.row.classList.add(ROW_CLASS, STATUS_CLASS[status]);
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
 * Lines the report does not mention are left untouched rather than shown as uncovered:
 * coverage tools only instrument executable lines, so marking blank lines, comments and
 * declarations red would be actively misleading.
 */
export function renderBlock(
  block: FileBlock,
  coverage: FileCoverage,
  options: RenderOptions,
): RenderStats {
  const stats: RenderStats = { annotated: 0, covered: 0, partial: 0, uncovered: 0, unknown: 0 };

  for (const line of block.lines) {
    const entry = coverage.lines.get(line.number);
    if (!entry) {
      stats.unknown++;
      continue;
    }

    let status = lineStatus(entry);
    if (status === 'partial' && !options.showPartial) {
      status = 'covered';
    }

    const branches =
      entry.branches !== undefined && entry.coveredBranches !== undefined
        ? `${entry.coveredBranches}/${entry.branches} branches`
        : undefined;

    // Repainting an unchanged line churns the DOM on every mutation callback.
    if (line.gutter.getAttribute(STAMP_ATTRIBUTE) !== status) {
      paint(line, status, describe(status, entry.hits, branches), options);
    }

    stats.annotated++;
    if (status === 'covered') {
      stats.covered++;
    } else if (status === 'partial') {
      stats.partial++;
    } else {
      stats.uncovered++;
    }
  }

  return stats;
}

export function emptyStats(): RenderStats {
  return { annotated: 0, covered: 0, partial: 0, uncovered: 0, unknown: 0 };
}

export function addStats(a: RenderStats, b: RenderStats): RenderStats {
  return {
    annotated: a.annotated + b.annotated,
    covered: a.covered + b.covered,
    partial: a.partial + b.partial,
    uncovered: a.uncovered + b.uncovered,
    unknown: a.unknown + b.unknown,
  };
}
