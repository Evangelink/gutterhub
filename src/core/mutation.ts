import type { AnalysedFile, Analysis, FileSummary } from './analysis.js';
import { applyMarkOptions, type LineMark, type MarkOptions, type MarkStatus } from './marks.js';
import {
  countsTowardsScore,
  isDetected,
  isUndetected,
  type FileMutation,
  type Mutant,
  type MutationReport,
} from './parsers/mutation.js';

function summariseLine(mutants: readonly Mutant[]): {
  status: MarkStatus;
  detected: number;
  scored: number;
} | null {
  let detected = 0;
  let undetected = 0;

  for (const mutant of mutants) {
    if (isDetected(mutant.status)) {
      detected++;
    } else if (isUndetected(mutant.status)) {
      undetected++;
    }
  }

  const scored = detected + undetected;
  if (scored === 0) {
    // Every mutant here failed to compile, errored or was ignored. That is a fact about
    // the mutation run, not about the tests, so the line gets no mark.
    return null;
  }

  const status: MarkStatus = undetected === 0 ? 'good' : detected === 0 ? 'bad' : 'partial';

  return { status, detected, scored };
}

function describe(mutants: readonly Mutant[], detected: number, scored: number): string {
  const parts = [`${detected}/${scored} mutants killed`];

  const survivors = mutants.filter((mutant) => isUndetected(mutant.status));
  if (survivors.length > 0) {
    // Naming the mutator is the actionable part: it says what test is missing.
    const names = [...new Set(survivors.map((mutant) => mutant.mutator))].slice(0, 3);
    const noCoverage = survivors.some((mutant) => mutant.status === 'NoCoverage');
    parts.push(`${noCoverage ? 'not covered' : 'survived'}: ${names.join(', ')}`);
  }

  const skipped = mutants.length - scored;
  if (skipped > 0) {
    parts.push(`${skipped} not scored`);
  }

  return parts.join(' · ');
}

/**
 * Converts a mutation report for one file into renderable marks.
 *
 * A line usually carries several mutants, so the three visual states come from
 * aggregating them: all killed reads as good, all survived as bad, and a mix as partial.
 * That last case is the interesting one — it is precisely the code that line coverage
 * reports as fully covered while some of its behaviour goes untested.
 */
export function mutationMarks(file: FileMutation, options: MarkOptions): Map<number, LineMark> {
  const marks = new Map<number, LineMark>();

  for (const [line, mutants] of file.lines) {
    const summary = summariseLine(mutants);
    if (!summary) {
      continue;
    }

    marks.set(line, {
      line,
      status: applyMarkOptions(summary.status, options),
      tooltip: describe(mutants, summary.detected, summary.scored),
    });
  }

  return marks;
}

/** Mutation score for a file: detected mutants over all scoreable ones. */
export function mutationSummary(file: FileMutation): FileSummary {
  let detected = 0;
  let scored = 0;

  for (const mutants of file.lines.values()) {
    for (const mutant of mutants) {
      if (!countsTowardsScore(mutant.status)) {
        continue;
      }
      scored++;
      if (isDetected(mutant.status)) {
        detected++;
      }
    }
  }

  return {
    percent: scored === 0 ? null : (detected / scored) * 100,
    label: 'mutants killed',
  };
}

export function mutationAnalysis(report: MutationReport): Analysis {
  const files: AnalysedFile[] = report.files.map((file) => ({
    path: file.path,
    marks: (options) => mutationMarks(file, options),
    summary: () => mutationSummary(file),
  }));

  return { kind: 'mutation', files };
}
