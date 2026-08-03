import type { CoverageReport, FileCoverage, LineCoverage } from '../model.js';

/**
 * Parses an LCOV tracefile.
 *
 * Only the records carrying line-level information are consumed:
 *   SF:<path>                              start of a file record
 *   DA:<line>,<hits>                       line execution count
 *   BRDA:<line>,<block>,<branch>,<taken>   branch data ("-" means never reached)
 *   end_of_record
 *
 * Everything else (FN/FNDA/LF/LH/BRF/BRH/TN) is ignored: totals are recomputed from
 * the line records so that a truncated or internally inconsistent file still renders.
 */
export function parseLcov(text: string): CoverageReport {
  const files: FileCoverage[] = [];

  let current: FileCoverage | null = null;
  // Branch hits are accumulated separately because BRDA emits one record per branch
  // while several branches can share a single line.
  let branchTotals = new Map<number, { total: number; covered: number }>();

  const flush = (): void => {
    if (current === null) {
      return;
    }

    for (const [line, counts] of branchTotals) {
      const entry = current.lines.get(line);
      if (entry) {
        entry.branches = counts.total;
        entry.coveredBranches = counts.covered;
      }
    }

    if (current.lines.size > 0) {
      files.push(current);
    }
    current = null;
    branchTotals = new Map();
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    if (line === 'end_of_record') {
      flush();
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const tag = line.slice(0, separator);
    const value = line.slice(separator + 1);

    switch (tag) {
      case 'SF': {
        // A missing end_of_record is common in concatenated tracefiles.
        flush();
        current = { path: value.trim(), lines: new Map<number, LineCoverage>() };
        break;
      }

      case 'DA': {
        if (current === null) {
          break;
        }
        const [lineText, hitsText] = value.split(',');
        const lineNumber = Number.parseInt(lineText ?? '', 10);
        if (Number.isNaN(lineNumber)) {
          break;
        }
        const parsedHits = Number.parseInt(hitsText ?? '', 10);
        const hits = Number.isNaN(parsedHits) ? 0 : parsedHits;
        const existing = current.lines.get(lineNumber);
        if (existing) {
          existing.hits = (existing.hits ?? 0) + hits;
        } else {
          current.lines.set(lineNumber, { line: lineNumber, hits });
        }
        break;
      }

      case 'BRDA': {
        if (current === null) {
          break;
        }
        const parts = value.split(',');
        const lineNumber = Number.parseInt(parts[0] ?? '', 10);
        if (Number.isNaN(lineNumber)) {
          break;
        }
        const takenText = parts[3] ?? '-';
        const counts = branchTotals.get(lineNumber) ?? { total: 0, covered: 0 };
        counts.total += 1;
        // "-" means the branch was never reached, so it cannot have been taken.
        if (takenText !== '-' && Number.parseInt(takenText, 10) > 0) {
          counts.covered += 1;
        }
        branchTotals.set(lineNumber, counts);
        break;
      }

      default:
        break;
    }
  }

  flush();

  return { format: 'lcov', files };
}

export function looksLikeLcov(text: string): boolean {
  return /^\s*(TN:|SF:)/m.test(text);
}
