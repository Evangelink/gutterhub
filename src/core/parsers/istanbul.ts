import type { CoverageReport, FileCoverage, LineCoverage } from '../model.js';

interface IstanbulPosition {
  line?: number;
  column?: number;
}

interface IstanbulLocation {
  start?: IstanbulPosition;
  end?: IstanbulPosition;
}

interface IstanbulBranch extends IstanbulLocation {
  loc?: IstanbulLocation;
  locations?: IstanbulLocation[];
}

interface IstanbulFileCoverage {
  path?: string;
  statementMap?: Record<string, IstanbulLocation>;
  s?: Record<string, number>;
  branchMap?: Record<string, IstanbulBranch>;
  b?: Record<string, number[]>;
}

function startLine(location: IstanbulLocation | undefined): number | null {
  const line = location?.start?.line;
  return typeof line === 'number' && Number.isFinite(line) && line > 0 ? line : null;
}

/**
 * Parses Istanbul's `coverage-final.json` (the raw per-file coverage map produced by
 * nyc, Jest and Vitest).
 *
 * Istanbul tracks statements rather than lines, so several statements can map onto the
 * same line. A line is reported with the highest hit count of its statements: summing
 * would inflate counts for lines holding multiple statements, and taking the lowest
 * would mark a line uncovered because of an unreached trailing expression.
 */
export function parseIstanbul(text: string): CoverageReport {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Istanbul coverage must be a JSON object keyed by file path.');
  }

  const files: FileCoverage[] = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }

    const entry = value as IstanbulFileCoverage;
    if (!entry.statementMap || !entry.s) {
      continue;
    }

    const lines = new Map<number, LineCoverage>();

    for (const [statementId, location] of Object.entries(entry.statementMap)) {
      const line = startLine(location);
      if (line === null) {
        continue;
      }

      const hits = entry.s[statementId] ?? 0;
      const existing = lines.get(line);
      if (existing) {
        existing.hits = Math.max(existing.hits ?? 0, hits);
      } else {
        lines.set(line, { line, hits });
      }
    }

    if (entry.branchMap && entry.b) {
      for (const [branchId, branch] of Object.entries(entry.branchMap)) {
        const counts = entry.b[branchId];
        if (!Array.isArray(counts) || counts.length === 0) {
          continue;
        }

        const locations = branch.locations ?? [];

        for (let index = 0; index < counts.length; index++) {
          // Prefer the individual branch location; `if` branches without an explicit
          // else still carry a location, but fall back to the branch root when absent.
          const line = startLine(locations[index]) ?? startLine(branch.loc ?? branch);
          if (line === null) {
            continue;
          }

          const target = lines.get(line);
          if (!target) {
            continue;
          }

          target.branches = (target.branches ?? 0) + 1;
          if ((counts[index] ?? 0) > 0) {
            target.coveredBranches = (target.coveredBranches ?? 0) + 1;
          } else {
            target.coveredBranches = target.coveredBranches ?? 0;
          }
        }
      }
    }

    if (lines.size > 0) {
      files.push({ path: entry.path ?? key, lines });
    }
  }

  return { format: 'istanbul', files };
}

export function looksLikeIstanbul(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) {
    return false;
  }
  // Cheap structural probe: avoids parsing a large JSON document twice.
  return trimmed.includes('"statementMap"') && trimmed.includes('"s"');
}
