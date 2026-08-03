import type { CoverageSource } from '../shared/settings.js';
import { azureDevOpsProvider } from './azureDevOps.js';
import { githubActionsProvider } from './githubActions.js';
import { manualProvider } from './manual.js';
import { urlTemplateProvider } from './urlTemplate.js';
import {
  CoverageResolutionError,
  type CoverageProvider,
  type ResolveRequest,
  type ResolvedCoverage,
} from './types.js';

export { CoverageResolutionError, globMatch } from './types.js';
export type { CoverageProvider, ResolveRequest, ResolvedCoverage } from './types.js';
export { expandTemplate, templateValues } from './urlTemplate.js';
export { clearManualReport, loadManualReport, saveManualReport } from './manual.js';
export { GitHubApi } from './githubApi.js';
export { readArchive } from './archive.js';

const PROVIDERS: readonly CoverageProvider[] = [
  urlTemplateProvider,
  githubActionsProvider,
  azureDevOpsProvider,
  manualProvider,
];

export function providerFor(kind: CoverageSource['kind']): CoverageProvider {
  const provider = PROVIDERS.find((candidate) => candidate.kind === kind);
  if (!provider) {
    throw new CoverageResolutionError(`No provider registered for source "${kind}".`);
  }
  return provider;
}

export function resolveCoverage(
  source: CoverageSource,
  request: ResolveRequest,
): Promise<ResolvedCoverage> {
  return providerFor(source.kind).resolve(source, request);
}
