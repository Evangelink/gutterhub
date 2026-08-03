import type { CoverageSource } from '../shared/settings.js';
import { CoverageResolutionError, type CoverageProvider, type ResolveRequest } from './types.js';

export interface TemplateValues {
  owner: string;
  repo: string;
  sha: string;
  shortSha: string;
  ref: string;
  branch: string;
  pr: string;
  host: string;
  path: string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function templateValues(request: ResolveRequest): TemplateValues {
  const { context, sha } = request;

  return {
    owner: context.owner,
    repo: context.repo,
    sha,
    shortSha: sha.slice(0, 7),
    ref: context.ref ?? request.branch ?? sha,
    branch: request.branch ?? context.ref ?? '',
    pr: context.pullNumber === undefined ? '' : String(context.pullNumber),
    host: context.host,
    path: context.path ?? '',
  };
}

/**
 * Substitutes `{name}` placeholders. Unknown names are rejected rather than left in
 * place, because a silently unresolved placeholder produces a 404 that is far harder to
 * diagnose than a configuration error.
 */
export function expandTemplate(template: string, values: TemplateValues): string {
  const unknown: string[] = [];

  const expanded = template.replace(PLACEHOLDER, (match, name: string) => {
    if (!(name in values)) {
      unknown.push(name);
      return match;
    }
    return encodeURIComponent(values[name as keyof TemplateValues]);
  });

  if (unknown.length > 0) {
    throw new CoverageResolutionError(
      `Unknown placeholder${unknown.length > 1 ? 's' : ''} in URL template: ${unknown
        .map((name) => `{${name}}`)
        .join(', ')}.`,
      `Available placeholders: ${Object.keys(values)
        .map((name) => `{${name}}`)
        .join(', ')}.`,
    );
  }

  return expanded;
}

function fileNameOf(url: string): string | undefined {
  try {
    const segments = new URL(url).pathname.split('/');
    return segments[segments.length - 1] || undefined;
  } catch {
    return undefined;
  }
}

/** Fetches a report from a URL built out of the current page's coordinates. */
export const urlTemplateProvider: CoverageProvider = {
  kind: 'url-template',

  async resolve(source: CoverageSource, request: ResolveRequest) {
    if (source.kind !== 'url-template') {
      throw new CoverageResolutionError('Wrong provider for this source.');
    }

    if (source.template.trim().length === 0) {
      throw new CoverageResolutionError(
        'No coverage URL configured for this repository.',
        'Set one in GutterHub options.',
      );
    }

    const url = expandTemplate(source.template.trim(), templateValues(request));

    let response: Response;
    try {
      response = await fetch(url, { credentials: 'omit' });
    } catch (error) {
      throw new CoverageResolutionError(
        `Could not reach ${url}.`,
        error instanceof Error ? error.message : undefined,
      );
    }

    if (!response.ok) {
      throw new CoverageResolutionError(
        `Coverage URL returned HTTP ${response.status}.`,
        `Requested ${url}`,
      );
    }

    return {
      text: await response.text(),
      label: url,
      ...(fileNameOf(url) ? { fileName: fileNameOf(url)! } : {}),
    };
  },
};
