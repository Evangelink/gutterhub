import type { PageContext } from '../github/location.js';
import type { CoverageSource } from '../shared/settings.js';

/** Everything a provider needs to locate a report for the page being viewed. */
export interface ResolveRequest {
  context: PageContext;
  /** Head commit of the pull request, or the commit/ref being viewed. */
  sha: string;
  /** Branch name when known; used by URL templates. */
  branch?: string;
  token: string;
}

export interface ResolvedCoverage {
  /** Raw report contents, handed to the parsers unchanged. */
  text: string;
  /** Human-readable origin, shown in the popup so users can tell what was loaded. */
  label: string;
  /** File name hint used to break ties during format detection. */
  fileName?: string;
}

export interface CoverageProvider {
  readonly kind: CoverageSource['kind'];
  resolve(source: CoverageSource, request: ResolveRequest): Promise<ResolvedCoverage>;
}

/** Raised for conditions the user can act on; the message is surfaced in the popup. */
export class CoverageResolutionError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CoverageResolutionError';
    this.hint = hint;
  }
}

/**
 * Matches a name against a pattern where `*` stands for any run of characters.
 * Used for artifact names, which vary per run (`coverage-net8.0`, `coverage-net9.0`, …).
 */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern.length === 0) {
    return false;
  }

  const expression = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${expression}$`, 'i').test(value);
}
