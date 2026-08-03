import type { CoverageFormat, CoverageReport } from '../model.js';
import { looksLikeCobertura, parseCobertura } from './cobertura.js';
import { looksLikeIstanbul, parseIstanbul } from './istanbul.js';
import { looksLikeLcov, parseLcov } from './lcov.js';

export { parseCobertura, parseIstanbul, parseLcov };
export { parseMutation, looksLikeMutation } from './mutation.js';
export type { CoberturaReport } from './cobertura.js';
export type { FileMutation, Mutant, MutantStatus, MutationReport } from './mutation.js';

export class UnknownReportError extends Error {
  constructor(hint?: string) {
    super(
      `Unrecognised report format${hint ? ` (${hint})` : ''}. ` +
        'GutterHub understands LCOV, Cobertura XML and Istanbul JSON coverage, ' +
        'and mutation-testing-elements JSON.',
    );
    this.name = 'UnknownReportError';
  }
}

/**
 * Identifies a *coverage* format. Returns null for anything else, including mutation
 * reports — {@link detectKind} in `core/parse.ts` is the entry point that spans kinds.
 */
export function detectFormat(text: string, fileName?: string): CoverageFormat | null {
  // Content sniffing first: file names lie far more often than payloads do
  // (`coverage.xml` is Cobertura, JaCoCo, or Clover depending on the tool).
  if (looksLikeLcov(text)) {
    return 'lcov';
  }
  if (looksLikeCobertura(text)) {
    return 'cobertura';
  }
  if (looksLikeIstanbul(text)) {
    return 'istanbul';
  }

  const name = fileName?.toLowerCase() ?? '';
  if (name.endsWith('.info') || name.includes('lcov')) {
    return 'lcov';
  }
  if (name.endsWith('.xml')) {
    return 'cobertura';
  }

  // A bare `.json` is deliberately not assumed to be Istanbul: mutation reports are JSON
  // too, and guessing wrong produces a confidently empty overlay.
  return null;
}

export function parseCoverage(text: string, fileName?: string): CoverageReport {
  switch (detectFormat(text, fileName)) {
    case 'lcov':
      return parseLcov(text);
    case 'cobertura':
      return parseCobertura(text);
    case 'istanbul':
      return parseIstanbul(text);
    default:
      throw new UnknownReportError(fileName);
  }
}
