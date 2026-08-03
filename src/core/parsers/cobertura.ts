import type { CoverageReport, FileCoverage, LineCoverage } from '../model.js';
import { scanXml } from './xml.js';

export interface CoberturaReport extends CoverageReport {
  /**
   * Values of `<sources><source>`. Cobertura filenames are usually relative to one of
   * these roots, which matters when mapping onto repository paths.
   */
  sources: string[];
}

const CONDITION_COVERAGE_PATTERN = /\((\d+)\s*\/\s*(\d+)\)/;

function parseConditionCoverage(value: string | undefined): { covered: number; total: number } | null {
  if (!value) {
    return null;
  }

  // Format is e.g. `50% (1/2)`; the percentage alone is lossy for high branch counts.
  const match = CONDITION_COVERAGE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const covered = Number.parseInt(match[1]!, 10);
  const total = Number.parseInt(match[2]!, 10);
  if (Number.isNaN(covered) || Number.isNaN(total)) {
    return null;
  }

  return { covered, total };
}

/**
 * Parses a Cobertura XML report.
 *
 * Several `<class>` elements frequently share one `filename` (partial classes, or one
 * element per type in a file), so line data is merged per filename rather than per class.
 */
export function parseCobertura(text: string): CoberturaReport {
  const sources: string[] = [];
  const byFile = new Map<string, FileCoverage>();

  let currentFile: FileCoverage | null = null;
  let inSources = false;

  scanXml(text, {
    onOpen(tag) {
      switch (tag.name) {
        case 'sources':
          inSources = true;
          break;

        case 'class': {
          const filename = tag.attributes['filename'];
          if (!filename) {
            currentFile = null;
            break;
          }
          let file = byFile.get(filename);
          if (!file) {
            file = { path: filename, lines: new Map<number, LineCoverage>() };
            byFile.set(filename, file);
          }
          currentFile = file;
          break;
        }

        case 'line': {
          if (currentFile === null) {
            break;
          }
          const lineNumber = Number.parseInt(tag.attributes['number'] ?? '', 10);
          if (Number.isNaN(lineNumber)) {
            break;
          }
          const parsedHits = Number.parseInt(tag.attributes['hits'] ?? '', 10);
          const hits = Number.isNaN(parsedHits) ? 0 : parsedHits;

          const entry: LineCoverage = currentFile.lines.get(lineNumber) ?? {
            line: lineNumber,
            hits: 0,
          };
          entry.hits = (entry.hits ?? 0) + hits;

          if (tag.attributes['branch'] === 'true') {
            const condition = parseConditionCoverage(tag.attributes['condition-coverage']);
            if (condition && condition.total > 0) {
              entry.branches = Math.max(entry.branches ?? 0, condition.total);
              entry.coveredBranches = Math.max(entry.coveredBranches ?? 0, condition.covered);
            }
          }

          currentFile.lines.set(lineNumber, entry);
          break;
        }

        default:
          break;
      }
    },

    onClose(name) {
      if (name === 'sources') {
        inSources = false;
      } else if (name === 'class') {
        currentFile = null;
      }
    },

    onText(value, parent) {
      if (inSources && parent === 'source' && value.length > 0) {
        sources.push(value);
      }
    },
  });

  return {
    format: 'cobertura',
    sources,
    files: [...byFile.values()].filter((file) => file.lines.size > 0),
  };
}

export function looksLikeCobertura(text: string): boolean {
  return /<coverage\b/i.test(text) && /<(class|package)\b/i.test(text);
}
