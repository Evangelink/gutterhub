/** Anything that can be located by a path from a report. */
export interface PathedRecord {
  path: string;
}

export interface PathMatchOptions {
  /**
   * Leading segments removed from every coverage path before matching, e.g. `packages/app`
   * when the coverage tool runs inside a workspace package.
   */
  stripPrefix?: string;
  /**
   * Prepended to every coverage path before matching, for the reverse situation where the
   * report is relative to a directory that is itself nested in the repository.
   */
  addPrefix?: string;
  /** Compare paths case-insensitively. Needed for reports produced on Windows agents. */
  ignoreCase?: boolean;
}

export interface PathMatch<T extends PathedRecord> {
  file: T;
  /** Number of trailing path segments shared with the requested repository path. */
  score: number;
  /** True when more than one entry matched equally well. */
  ambiguous: boolean;
}

/**
 * Normalises a path for comparison: Windows separators become POSIX ones, `.` segments
 * and duplicate separators are collapsed, and drive letters, URL schemes and leading
 * separators are dropped so that absolute build paths can be compared with the
 * repository-relative paths GitHub exposes.
 */
export function normalisePath(input: string): string {
  let path = input.trim().replace(/\\/g, '/');

  // `file:///D:/a/1/s/src/Foo.cs` and friends.
  path = path.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
  // `D:/a/1/s/...`, and `/D:/a/1/s/...` as left behind by a `file://` URL.
  path = path.replace(/^\/*[a-zA-Z]:\//, '');

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return segments.join('/');
}

function segmentsOf(path: string): string[] {
  return path.length === 0 ? [] : path.split('/');
}

/** Counts trailing segments shared by two paths, comparing whole segments only. */
export function commonSuffixSegments(a: readonly string[], b: readonly string[]): number {
  let count = 0;
  let indexA = a.length - 1;
  let indexB = b.length - 1;

  while (indexA >= 0 && indexB >= 0 && a[indexA] === b[indexB]) {
    count++;
    indexA--;
    indexB--;
  }

  return count;
}

interface IndexedFile<T extends PathedRecord> {
  file: T;
  segments: string[];
  /** Lower-cased segments, used by the case-insensitive fallback. */
  foldedSegments: string[];
}

/**
 * Resolves repository paths onto report entries.
 *
 * Reports are wildly inconsistent about how they spell paths — absolute CI workspace
 * paths, paths relative to a project directory, or bare file names — so an exact lookup
 * is not workable. Entries are indexed by file name and the candidate sharing the longest
 * trailing run of segments wins.
 *
 * Nothing here is coverage-specific: any report kind whose entries carry a `path` reuses
 * it unchanged.
 */
export class PathIndex<T extends PathedRecord> {
  /** Keyed by lower-cased file name so that both match passes share one bucket lookup. */
  private readonly byFileName = new Map<string, IndexedFile<T>[]>();
  private readonly ignoreCase: boolean;
  private count = 0;

  constructor(files: readonly T[], options: PathMatchOptions = {}) {
    this.ignoreCase = options.ignoreCase ?? false;

    const stripPrefix = options.stripPrefix ? normalisePath(options.stripPrefix) : '';
    const addPrefix = options.addPrefix ? normalisePath(options.addPrefix) : '';

    for (const file of files) {
      let path = normalisePath(file.path);

      if (stripPrefix.length > 0) {
        if (path === stripPrefix) {
          path = '';
        } else if (path.startsWith(`${stripPrefix}/`)) {
          path = path.slice(stripPrefix.length + 1);
        }
      }

      if (addPrefix.length > 0) {
        path = path.length > 0 ? `${addPrefix}/${path}` : addPrefix;
      }

      if (path.length === 0) {
        continue;
      }

      const segments = segmentsOf(path);
      const fileName = segments[segments.length - 1];
      if (fileName === undefined) {
        continue;
      }

      const entry: IndexedFile<T> = {
        file,
        segments,
        foldedSegments: segments.map((segment) => segment.toLowerCase()),
      };

      const key = fileName.toLowerCase();
      const bucket = this.byFileName.get(key);
      if (bucket) {
        bucket.push(entry);
      } else {
        this.byFileName.set(key, [entry]);
      }
      this.count++;
    }
  }

  /** Number of entries in the index. */
  get size(): number {
    return this.count;
  }

  match(repositoryPath: string): PathMatch<T> | null {
    const segments = segmentsOf(normalisePath(repositoryPath));
    const fileName = segments[segments.length - 1];
    if (fileName === undefined) {
      return null;
    }

    const bucket = this.byFileName.get(fileName.toLowerCase());
    if (!bucket || bucket.length === 0) {
      return null;
    }

    if (!this.ignoreCase) {
      const exact = bestMatch(bucket, segments, (entry) => entry.segments);
      if (exact !== null) {
        return exact;
      }
    }

    // Reports produced on Windows agents routinely disagree with the repository on
    // casing, so fall back to a folded comparison rather than reporting no coverage.
    const folded = segments.map((segment) => segment.toLowerCase());
    return bestMatch(bucket, folded, (entry) => entry.foldedSegments);
  }

  lookup(repositoryPath: string): T | null {
    return this.match(repositoryPath)?.file ?? null;
  }
}

function bestMatch<T extends PathedRecord>(
  bucket: readonly IndexedFile<T>[],
  segments: readonly string[],
  select: (entry: IndexedFile<T>) => string[],
): PathMatch<T> | null {
  let best: IndexedFile<T> | null = null;
  let bestScore = 0;
  let ambiguous = false;

  for (const candidate of bucket) {
    const candidateSegments = select(candidate);
    const score = commonSuffixSegments(candidateSegments, segments);
    if (score === 0) {
      continue;
    }

    // A match must consume one of the two paths entirely, otherwise `a/b/Foo.cs` would
    // match `x/b/Foo.cs` and silently paint coverage from an unrelated file.
    if (score < Math.min(candidateSegments.length, segments.length)) {
      continue;
    }

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      ambiguous = false;
    } else if (score === bestScore && best !== null && candidate.file !== best.file) {
      ambiguous = true;
    }
  }

  return best === null ? null : { file: best.file, score: bestScore, ambiguous };
}
