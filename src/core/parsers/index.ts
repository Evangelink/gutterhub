import type { CoverageFormat, CoverageReport } from '../model.js';
import { looksLikeCobertura, parseCobertura } from './cobertura.js';
import { looksLikeIstanbul, parseIstanbul } from './istanbul.js';
import { looksLikeLcov, parseLcov } from './lcov.js';

export { parseCobertura, parseIstanbul, parseLcov };
export type { CoberturaReport } from './cobertura.js';

export class UnknownCoverageFormatError extends Error {
  constructor(hint?: string) {
    super(
      `Unrecognised coverage report format${hint ? ` (${hint})` : ''}. ` +
        'GutterHub understands LCOV, Cobertura XML and Istanbul JSON.',
    );
    this.name = 'UnknownCoverageFormatError';
  }
}

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
  if (name.endsWith('.json')) {
    return 'istanbul';
  }

  return null;
}

export function parseCoverage(text: string, fileName?: string): CoverageReport {
  const format = detectFormat(text, fileName);

  switch (format) {
    case 'lcov':
      return parseLcov(text);
    case 'cobertura':
      return parseCobertura(text);
    case 'istanbul':
      return parseIstanbul(text);
    default:
      throw new UnknownCoverageFormatError(fileName);
  }
}
