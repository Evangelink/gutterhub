import { CoverageResolutionError, type CoverageProvider, type ResolveRequest } from './types.js';
import type { CoverageSource } from '../shared/settings.js';

export interface ManualReport {
  text: string;
  fileName: string;
  savedAt: number;
}

function key(owner: string, repo: string): string {
  return `gutterhub:manual:${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

/**
 * Manual reports can be megabytes of text, well past the per-item quota of
 * `chrome.storage.sync`, so they always live in `local`.
 */
export async function saveManualReport(
  owner: string,
  repo: string,
  report: Omit<ManualReport, 'savedAt'>,
): Promise<void> {
  await chrome.storage.local.set({
    [key(owner, repo)]: { ...report, savedAt: Date.now() } satisfies ManualReport,
  });
}

export async function loadManualReport(owner: string, repo: string): Promise<ManualReport | null> {
  const stored = await chrome.storage.local.get(key(owner, repo));
  return (stored[key(owner, repo)] as ManualReport | undefined) ?? null;
}

export async function clearManualReport(owner: string, repo: string): Promise<void> {
  await chrome.storage.local.remove(key(owner, repo));
}

/**
 * Serves a report the user supplied by hand. Useful before pushing, for CI systems with
 * no reachable artifact URL, and for trying GutterHub out without any setup.
 */
export const manualProvider: CoverageProvider = {
  kind: 'manual',

  async resolve(source: CoverageSource, request: ResolveRequest) {
    if (source.kind !== 'manual') {
      throw new CoverageResolutionError('Wrong provider for this source.');
    }

    const report = await loadManualReport(request.context.owner, request.context.repo);
    if (!report) {
      throw new CoverageResolutionError(
        'No report has been uploaded for this repository.',
        'Open the GutterHub popup and paste or upload a coverage report.',
      );
    }

    return {
      text: report.text,
      label: `Uploaded ${report.fileName} (${new Date(report.savedAt).toLocaleString()})`,
      fileName: report.fileName,
    };
  },
};
