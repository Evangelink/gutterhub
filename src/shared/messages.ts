import type { ReportKind } from '../core/analysis.js';
import type { PageContext } from '../github/location.js';

export interface ResolveCoverageRequest {
  type: 'gutterhub:resolve';
  context: PageContext;
  /** Skips the cache, used by the popup's refresh button. */
  force?: boolean;
}

export interface ResolveCoverageSuccess {
  ok: true;
  text: string;
  label: string;
  fileName?: string;
  sha: string;
  /** True when the payload came from the cache rather than the network. */
  cached: boolean;
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
  /** Origin of the report, shown so users can confirm what was loaded. */
  label?: string;
  /** Which kind of report is on screen, so the UI can label the states correctly. */
  kind?: ReportKind;
  repositoryKey?: string;
  adapterId?: string;
  annotated?: number;
  good?: number;
  partial?: number;
  bad?: number;
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
