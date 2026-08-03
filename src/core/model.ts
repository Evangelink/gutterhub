/**
 * Vendor-neutral coverage model.
 *
 * Every supported report format (LCOV, Cobertura, Istanbul JSON) is normalised into
 * this shape so that the rendering layer never has to know where the data came from.
 */

/** Coverage status of a single source line. */
export type LineStatus = 'covered' | 'uncovered' | 'partial';

export interface LineCoverage {
  /** 1-based line number in the source file. */
  line: number;
  /** Number of times the line was executed. `null` when the format does not report hits. */
  hits: number | null;
  /** Total branches originating on this line, when known. */
  branches?: number;
  /** Branches taken at least once, when known. */
  coveredBranches?: number;
}

export interface FileCoverage {
  /**
   * Path exactly as it appeared in the coverage report. Kept verbatim so that path
   * matching can be re-run with different source roots without re-parsing.
   */
  path: string;
  /** Line coverage keyed by line number. */
  lines: Map<number, LineCoverage>;
}

export type CoverageFormat = 'lcov' | 'cobertura' | 'istanbul';

export interface CoverageReport {
  format: CoverageFormat;
  files: FileCoverage[];
}

export interface CoverageSummary {
  coveredLines: number;
  partialLines: number;
  uncoveredLines: number;
  totalLines: number;
  /** Percentage in the 0-100 range, or `null` when there are no instrumented lines. */
  percent: number | null;
}

// Verification branch: exercises the pull request diff adapter end to end.
export function lineStatus(line: LineCoverage): LineStatus {
  if (line.hits !== null && line.hits <= 0) {
    return 'uncovered';
  }

  // A line can be executed while some of its branches never are. Reporting that as
  // fully covered is how coverage tools hide missing test cases, so surface it.
  if (
    line.branches !== undefined &&
    line.coveredBranches !== undefined &&
    line.branches > 0 &&
    line.coveredBranches < line.branches
  ) {
    return 'partial';
  }

  return 'covered';
}

export function summarise(file: FileCoverage): CoverageSummary {
  let covered = 0;
  let partial = 0;
  let uncovered = 0;

  for (const line of file.lines.values()) {
    switch (lineStatus(line)) {
      case 'covered':
        covered++;
        break;
      case 'partial':
        partial++;
        break;
      case 'uncovered':
        uncovered++;
        break;
    }
  }

  const total = covered + partial + uncovered;

  return {
    coveredLines: covered,
    partialLines: partial,
    uncoveredLines: uncovered,
    totalLines: total,
    // Partial lines count as hit: they were executed, just not exhaustively. This
    // matches how LCOV and Cobertura compute their own line-rate.
    percent: total === 0 ? null : ((covered + partial) / total) * 100,
  };
}

/**
 * Merges several reports into one. Hit counts are summed so that reports split per
 * test project add up, and branch data keeps the most complete observation.
 */
export function mergeReports(reports: CoverageReport[]): CoverageReport | null {
  if (reports.length === 0) {
    return null;
  }
  if (reports.length === 1) {
    return reports[0]!;
  }

  const byPath = new Map<string, FileCoverage>();

  for (const report of reports) {
    for (const file of report.files) {
      let existing = byPath.get(file.path);
      if (!existing) {
        existing = { path: file.path, lines: new Map() };
        for (const [lineNumber, line] of file.lines) {
          existing.lines.set(lineNumber, { ...line });
        }
        byPath.set(file.path, existing);
        continue;
      }

      for (const [lineNumber, line] of file.lines) {
        const previous = existing.lines.get(lineNumber);
        if (!previous) {
          existing.lines.set(lineNumber, { ...line });
          continue;
        }

        const branches = Math.max(previous.branches ?? 0, line.branches ?? 0);
        const coveredBranches = Math.max(previous.coveredBranches ?? 0, line.coveredBranches ?? 0);

        existing.lines.set(lineNumber, {
          line: lineNumber,
          hits:
            previous.hits === null && line.hits === null
              ? null
              : (previous.hits ?? 0) + (line.hits ?? 0),
          ...(branches > 0 ? { branches, coveredBranches } : {}),
        });
      }
    }
  }

  return { format: reports[0]!.format, files: [...byPath.values()] };
}
