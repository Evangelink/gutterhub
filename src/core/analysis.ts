import type { LineMark, MarkOptions, MarkStatus } from './marks.js';

/** The kinds of report GutterHub understands. */
export type ReportKind = 'coverage' | 'mutation';

export interface FileSummary {
  /** Headline figure in the 0-100 range, or `null` when there is nothing to measure. */
  percent: number | null;
  /** What the figure measures, e.g. `covered` or `mutants killed`. */
  label: string;
}

/**
 * One file's worth of analysis, in the only shape the rest of the extension consumes.
 *
 * Marks are produced on demand rather than up front because {@link MarkOptions} is a
 * display setting that can change without re-fetching or re-parsing the report.
 */
export interface AnalysedFile {
  readonly path: string;
  marks(options: MarkOptions): Map<number, LineMark>;
  summary(): FileSummary;
}

export interface Analysis {
  kind: ReportKind;
  files: AnalysedFile[];
}

/** How a report kind describes itself in the UI. */
export interface KindPresentation {
  title: string;
  /** Words for the three visual states, in this report's own vocabulary. */
  legend: Record<MarkStatus, string>;
}

export const PRESENTATION: Record<ReportKind, KindPresentation> = {
  coverage: {
    title: 'Code coverage',
    legend: { good: 'covered', partial: 'partial', bad: 'uncovered' },
  },
  mutation: {
    title: 'Mutation testing',
    legend: { good: 'killed', partial: 'partly killed', bad: 'survived' },
  },
};
