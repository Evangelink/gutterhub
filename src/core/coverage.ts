import type { AnalysedFile, Analysis } from './analysis.js';
import { applyMarkOptions, type LineMark, type MarkOptions, type MarkStatus } from './marks.js';
import { lineStatus, summarise, type CoverageReport, type FileCoverage } from './model.js';

const STATUS: Record<ReturnType<typeof lineStatus>, MarkStatus> = {
  covered: 'good',
  partial: 'partial',
  uncovered: 'bad',
};

function describe(status: MarkStatus, hits: number | null, branches: string | undefined): string {
  const base =
    status === 'good'
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
export function coverageMarks(file: FileCoverage, options: MarkOptions): Map<number, LineMark> {
  const marks = new Map<number, LineMark>();

  for (const [line, entry] of file.lines) {
    const status = applyMarkOptions(STATUS[lineStatus(entry)], options);

    const branches =
      entry.branches !== undefined && entry.coveredBranches !== undefined
        ? `${entry.coveredBranches}/${entry.branches} branches`
        : undefined;

    marks.set(line, { line, status, tooltip: describe(status, entry.hits, branches) });
  }

  return marks;
}

export function coverageAnalysis(report: CoverageReport): Analysis {
  const files: AnalysedFile[] = report.files.map((file) => ({
    path: file.path,
    marks: (options) => coverageMarks(file, options),
    summary: () => ({ percent: summarise(file).percent, label: 'covered' }),
  }));

  return { kind: 'coverage', files };
}
