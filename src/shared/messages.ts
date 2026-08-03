import type { ReportKind } from '../core/analysis.js';
import type { PageContext } from '../github/location.js';

export interface ResolveCoverageRequest {
  type: 'gutterhub:resolve';
  context: PageContext;
  /** Skips the cache, used by the popup's refresh button. */
  force?: boolean;
}

export interface ResolvedReport {
  /** Raw report contents, handed to the parsers unchanged. */
  text: string;
  /** Human-readable origin, shown so users can tell what was loaded. */
  label: string;
  fileName?: string;
  /** True when this payload came from the cache rather than the network. */
  cached: boolean;
}

export interface ResolveCoverageSuccess {
  ok: true;
  reports: ResolvedReport[];
  sha: string;
  /**
   * Sources that failed while at least one other succeeded. Reported rather than thrown
   * so that a broken second source cannot hide a perfectly good first one.
   */
  warnings: string[];
}

export interface ResolveCoverageFailure {
  ok: false;
  error: string;
  hint?: string;
  /** Distinguishes "nothing configured" from a genuine failure in the popup. */
  reason: 'not-configured' | 'disabled' | 'error';
}

export type ResolveCoverageResponse = ResolveCoverageSuccess | ResolveCoverageFailure;

export interface StatusRequest {
  type: 'gutterhub:get-status';
}

export interface OverlayStatus {
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'not-configured' | 'disabled';
  message?: string;
  hint?: string;
  /** Origins of the loaded reports, so users can confirm what is on screen. */
  labels?: string[];
  /** Which kinds of report are on screen, so the UI can label the states correctly. */
  kinds?: ReportKind[];
  /** Sources that failed while others succeeded. */
  warnings?: string[];
  repositoryKey?: string;
  adapterId?: string;
  annotated?: number;
  good?: number;
  partial?: number;
  bad?: number;
  /** Lines where the loaded reports disagree — the actionable signal. */
  conflicts?: number;
  filesMatched?: number;
  filesTotal?: number;
}

export interface InvalidateRequest {
  type: 'gutterhub:invalidate';
}

export interface RefreshRequest {
  type: 'gutterhub:refresh';
}

export type GutterHubMessage =
  ResolveCoverageRequest | StatusRequest | InvalidateRequest | RefreshRequest;

export function isMessage<T extends GutterHubMessage['type']>(
  message: unknown,
  type: T,
): message is Extract<GutterHubMessage, { type: T }> {
  return (
    typeof message === 'object' && message !== null && (message as { type?: unknown }).type === type
  );
}
