import type { Analysis, ReportKind } from './analysis.js';
import { coverageAnalysis } from './coverage.js';
import { mutationAnalysis } from './mutation.js';
import { detectFormat, parseCoverage, UnknownReportError } from './parsers/index.js';
import { looksLikeMutation, parseMutation } from './parsers/mutation.js';

export type {
  AnalysedFile,
  Analysis,
  FileSummary,
  KindPresentation,
  ReportKind,
} from './analysis.js';
export { PRESENTATION } from './analysis.js';

/**
 * Identifies which kind of report a payload is.
 *
 * Mutation is tested first and on a distinctive key: a mutation report and an Istanbul
 * report are both top-level objects keyed by file path, so anything vaguer than
 * `"mutants"` would misfile one as the other.
 */
export function detectKind(text: string, fileName?: string): ReportKind | null {
  if (looksLikeMutation(text)) {
    return 'mutation';
  }
  return detectFormat(text, fileName) === null ? null : 'coverage';
}

/** Parses a report of any supported kind into the shape the renderer consumes. */
export function parseAnalysis(text: string, fileName?: string): Analysis {
  switch (detectKind(text, fileName)) {
    case 'mutation':
      return mutationAnalysis(parseMutation(text));
    case 'coverage':
      return coverageAnalysis(parseCoverage(text, fileName));
    default:
      throw new UnknownReportError(fileName);
  }
}
