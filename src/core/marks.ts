import { lineStatus, type FileCoverage } from './model.js';

/**
 * Visual state of a marked line, and the only vocabulary the renderer understands.
 *
 * This is the seam between "what the data means" and "what gets drawn". Coverage is
 * currently the sole producer, so the names are coverage-flavoured; a second producer
 * (mutation testing being the obvious one — killed/survived/no-coverage maps straight
 * onto these three) would map its own vocabulary here rather than teaching the renderer
 * a new one.
 */
export type MarkStatus = 'covered' | 'partial' | 'uncovered';

export interface LineMark {
  /** 1-based line number in the current version of the file. */
  line: number;
  status: MarkStatus;
  /** Shown on hover. Already fully formatted; the renderer does not interpret it. */
  tooltip: string;
}

export interface CoverageMarkOptions {
  /** When false, partially covered lines are presented as covered. */
  showPartial: boolean;
}

function describe(status: MarkStatus, hits: number | null, branches: string | undefined): string {
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

/**
 * Converts a coverage report for one file into renderable marks.
 *
 * Lines the report does not mention produce no mark at all. Coverage tools only
 * instrument executable lines, so emitting a mark for blank lines, comments and
 * declarations would paint them as untested.
 */
export function coverageMarks(
  file: FileCoverage,
  options: CoverageMarkOptions,
): Map<number, LineMark> {
  const marks = new Map<number, LineMark>();

  for (const [line, entry] of file.lines) {
    let status: MarkStatus = lineStatus(entry);
    if (status === 'partial' && !options.showPartial) {
      status = 'covered';
    }

    const branches =
      entry.branches !== undefined && entry.coveredBranches !== undefined
        ? `${entry.coveredBranches}/${entry.branches} branches`
        : undefined;

    marks.set(line, { line, status, tooltip: describe(status, entry.hits, branches) });
  }

  return marks;
}
