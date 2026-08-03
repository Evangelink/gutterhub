/**
 * The vocabulary shared by everything that draws on a line.
 *
 * These are *visual* states, not domain concepts. Each producer maps its own vocabulary
 * onto them — coverage maps covered/partially-covered/uncovered, mutation testing maps
 * killed/partly-killed/survived — which is what lets the renderer and the DOM adapters
 * stay entirely ignorant of where a mark came from.
 */
export type MarkStatus = 'good' | 'partial' | 'bad';

export interface LineMark {
  /** 1-based line number in the current version of the file. */
  line: number;
  status: MarkStatus;
  /** Shown on hover. Already fully formatted; the renderer does not interpret it. */
  tooltip: string;
}

export interface MarkOptions {
  /**
   * When false, `partial` marks are presented as `good`. Some teams treat "ran, but not
   * every branch" as covered and find the third colour noisy.
   */
  showPartial: boolean;
}

/** Applies {@link MarkOptions} that every producer should honour identically. */
export function applyMarkOptions(status: MarkStatus, options: MarkOptions): MarkStatus {
  return status === 'partial' && !options.showPartial ? 'good' : status;
}
