/**
 * Parser for the `mutation-testing-elements` report schema.
 *
 * This is the interchange format shared by Stryker (JS/TS), Stryker.NET (C#), Stryker4s
 * (Scala) and PIT (Java, via a converter), which is what makes mutation testing a
 * tractable second report kind: one parser covers the whole ecosystem.
 *
 * Schema: http://stryker-mutator.io/report.schema.json
 */

/** Result of a single mutation, per the schema's `MutantStatus` enum. */
export type MutantStatus =
  | 'Killed'
  | 'Survived'
  | 'NoCoverage'
  | 'CompileError'
  | 'RuntimeError'
  | 'Timeout'
  | 'Ignored'
  | 'Pending';

export interface Mutant {
  /** 1-based line on which the mutation starts. */
  line: number;
  status: MutantStatus;
  /** Category of the mutation, e.g. `ConditionalExpression`. */
  mutator: string;
  /** Human description of what was changed, when the tool provides one. */
  description?: string;
}

export interface FileMutation {
  path: string;
  /** Mutants grouped by the line they start on. */
  lines: Map<number, Mutant[]>;
}

export interface MutationReport {
  format: 'mutation';
  schemaVersion: string;
  files: FileMutation[];
}

/**
 * A mutant counts towards the mutation score only if it was actually testable.
 *
 * `Killed` and `Timeout` are both detections — a mutant that hangs the suite has been
 * caught just as surely as one that fails an assertion. `CompileError`, `RuntimeError`,
 * `Ignored` and `Pending` are excluded entirely, matching how Stryker computes its score:
 * they say something about the mutation tool, not about the tests.
 */
export function isDetected(status: MutantStatus): boolean {
  return status === 'Killed' || status === 'Timeout';
}

export function isUndetected(status: MutantStatus): boolean {
  return status === 'Survived' || status === 'NoCoverage';
}

export function countsTowardsScore(status: MutantStatus): boolean {
  return isDetected(status) || isUndetected(status);
}

const KNOWN_STATUSES = new Set<string>([
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
]);

interface RawMutant {
  id?: string;
  mutatorName?: string;
  description?: string;
  status?: string;
  location?: { start?: { line?: number } };
}

interface RawFile {
  mutants?: RawMutant[];
}

export function parseMutation(text: string): MutationReport {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('A mutation report must be a JSON object.');
  }

  const root = raw as { schemaVersion?: unknown; files?: unknown };
  if (typeof root.files !== 'object' || root.files === null) {
    throw new Error('A mutation report must have a "files" object.');
  }

  const files: FileMutation[] = [];

  for (const [path, value] of Object.entries(root.files as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }

    const mutants = (value as RawFile).mutants;
    if (!Array.isArray(mutants)) {
      continue;
    }

    const lines = new Map<number, Mutant[]>();

    for (const mutant of mutants) {
      const line = mutant?.location?.start?.line;
      const status = mutant?.status;

      if (typeof line !== 'number' || !Number.isFinite(line) || line <= 0) {
        continue;
      }
      // An unrecognised status is more likely a newer schema than corruption, but it
      // cannot be scored, so it is dropped rather than guessed at.
      if (typeof status !== 'string' || !KNOWN_STATUSES.has(status)) {
        continue;
      }

      const entry: Mutant = {
        line,
        status: status as MutantStatus,
        mutator: mutant.mutatorName ?? 'mutation',
        ...(mutant.description ? { description: mutant.description } : {}),
      };

      const bucket = lines.get(line);
      if (bucket) {
        bucket.push(entry);
      } else {
        lines.set(line, [entry]);
      }
    }

    if (lines.size > 0) {
      files.push({ path, lines });
    }
  }

  return {
    format: 'mutation',
    schemaVersion: typeof root.schemaVersion === 'string' ? root.schemaVersion : '',
    files,
  };
}

export function looksLikeMutation(text: string): boolean {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) {
    return false;
  }

  // `mutants` is the discriminator: Istanbul JSON also has a top-level object keyed by
  // file path, so testing for `files` alone would confuse the two.
  return trimmed.includes('"mutants"') && trimmed.includes('"files"');
}
