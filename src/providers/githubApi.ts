import { CoverageResolutionError } from './types.js';

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

export interface WorkflowArtifact {
  id: number;
  name: string;
  expired: boolean;
  size_in_bytes: number;
  archive_download_url: string;
}

/**
 * The REST API base for a host. github.com serves the API from a separate domain,
 * while GitHub Enterprise Server exposes it under `/api/v3` on the same host.
 */
export function apiBase(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

function authHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (token.length > 0) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

async function describeFailure(response: Response, what: string): Promise<never> {
  if (response.status === 401 || response.status === 403) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      throw new CoverageResolutionError(
        `GitHub API rate limit reached while ${what}.`,
        'Add a personal access token in GutterHub options to raise the limit.',
      );
    }
    throw new CoverageResolutionError(
      `Not authorised while ${what} (HTTP ${response.status}).`,
      'Add a token with the `repo` scope (or fine-grained Actions: read) in GutterHub options.',
    );
  }

  if (response.status === 404) {
    throw new CoverageResolutionError(
      `Nothing found while ${what} (HTTP 404).`,
      'Check the repository is correct and, for private repositories, that your token can read it.',
    );
  }

  throw new CoverageResolutionError(`Request failed while ${what} (HTTP ${response.status}).`);
}

export class GitHubApi {
  constructor(
    private readonly host: string,
    private readonly token: string,
  ) {}

  get hasToken(): boolean {
    return this.token.length > 0;
  }

  private async getJson<T>(path: string, what: string): Promise<T> {
    const response = await fetch(`${apiBase(this.host)}${path}`, {
      headers: authHeaders(this.token),
    });

    if (!response.ok) {
      await describeFailure(response, what);
    }

    return (await response.json()) as T;
  }

  /** Head commit SHA of a pull request. */
  async pullRequestHeadSha(owner: string, repo: string, pullNumber: number): Promise<string> {
    const pull = await this.getJson<{ head?: { sha?: string } }>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}`,
      `looking up pull request #${pullNumber}`,
    );

    const sha = pull.head?.sha;
    if (!sha) {
      throw new CoverageResolutionError(`Pull request #${pullNumber} has no head commit.`);
    }

    return sha;
  }

  async pullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<{ sha: string; branch: string | undefined }> {
    const pull = await this.getJson<{ head?: { sha?: string; ref?: string } }>(
      `/repos/${owner}/${repo}/pulls/${pullNumber}`,
      `looking up pull request #${pullNumber}`,
    );

    if (!pull.head?.sha) {
      throw new CoverageResolutionError(`Pull request #${pullNumber} has no head commit.`);
    }

    return { sha: pull.head.sha, branch: pull.head.ref };
  }

  /**
   * Resolves any ref — a branch, a tag, or a short SHA — to a full commit SHA.
   *
   * Artifact-based sources match builds on the commit, so a branch name taken straight
   * from a `/blob/main/...` URL never matches anything and silently reports "no coverage".
   */
  async commitSha(owner: string, repo: string, ref: string): Promise<string> {
    const commit = await this.getJson<{ sha?: string }>(
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
      `resolving "${ref}" to a commit`,
    );

    if (!commit.sha) {
      throw new CoverageResolutionError(`Could not resolve "${ref}" to a commit.`);
    }

    return commit.sha;
  }

  async workflowRuns(owner: string, repo: string, headSha: string): Promise<WorkflowRun[]> {
    const result = await this.getJson<{ workflow_runs?: WorkflowRun[] }>(
      `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=50`,
      `listing workflow runs for ${headSha.slice(0, 7)}`,
    );

    return result.workflow_runs ?? [];
  }

  async runArtifacts(owner: string, repo: string, runId: number): Promise<WorkflowArtifact[]> {
    const result = await this.getJson<{ artifacts?: WorkflowArtifact[] }>(
      `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
      `listing artifacts for run ${runId}`,
    );

    return result.artifacts ?? [];
  }

  /** Downloads an artifact archive. The API redirects to a signed URL, which fetch follows. */
  async downloadArtifact(owner: string, repo: string, artifactId: number): Promise<Uint8Array> {
    const response = await fetch(
      `${apiBase(this.host)}/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`,
      { headers: authHeaders(this.token) },
    );

    if (!response.ok) {
      await describeFailure(response, `downloading artifact ${artifactId}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}
