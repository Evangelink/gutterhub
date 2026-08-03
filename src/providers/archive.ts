import { unzipSync } from 'fflate';
import { detectFormat } from '../core/parsers/index.js';
import { looksLikeMutation } from '../core/parsers/mutation.js';
import { CoverageResolutionError, globMatch } from './types.js';

/** Entries larger than this are skipped: reports are text, not binaries. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

const LIKELY_REPORT_NAME = /(lcov|cobertura|coverage|clover|opencover|mutation|\.info$)/i;

export interface ArchiveEntry {
  name: string;
  text: string;
}

/**
 * Picks a report out of a downloaded artifact archive.
 *
 * Shared by every provider that hands back a zip, so that "which file in here is the
 * report?" is answered identically no matter which CI produced it.
 */
export function readArchive(archive: Uint8Array, entryName: string | undefined): ArchiveEntry {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch (error) {
    throw new CoverageResolutionError(
      'Artifact archive could not be read.',
      error instanceof Error ? error.message : undefined,
    );
  }

  const decoder = new TextDecoder();
  const candidates = Object.entries(files).filter(
    ([name, bytes]) => bytes.length > 0 && bytes.length <= MAX_ENTRY_BYTES && !name.endsWith('/'),
  );

  if (candidates.length === 0) {
    throw new CoverageResolutionError('Artifact archive is empty.');
  }

  if (entryName && entryName.trim().length > 0) {
    const wanted = candidates.find(([name]) => globMatch(entryName.trim(), name));
    if (!wanted) {
      throw new CoverageResolutionError(
        `No entry matching "${entryName}" in the artifact.`,
        `Archive contains: ${listing(candidates)}`,
      );
    }
    return { name: wanted[0], text: decoder.decode(wanted[1]) };
  }

  // Try the plausibly-named entries first so a report sitting beside logs and dumps is
  // found without decoding the whole archive.
  const ordered = [
    ...candidates.filter(([name]) => LIKELY_REPORT_NAME.test(name)),
    ...candidates.filter(([name]) => !LIKELY_REPORT_NAME.test(name)),
  ];

  for (const [name, bytes] of ordered) {
    const text = decoder.decode(bytes);
    if (detectFormat(text, name) !== null || looksLikeMutation(text)) {
      return { name, text };
    }
  }

  throw new CoverageResolutionError(
    'No recognisable report inside the artifact.',
    `Archive contains: ${listing(candidates)}`,
  );
}

function listing(candidates: readonly [string, Uint8Array][]): string {
  return candidates
    .slice(0, 10)
    .map(([name]) => name)
    .join(', ');
}
