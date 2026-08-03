import { describe, expect, it } from 'vitest';
import { looksLikeMutation, parseMutation } from '../src/core/parsers/mutation.js';
import { mutationAnalysis, mutationMarks, mutationSummary } from '../src/core/mutation.js';
import { detectKind, parseAnalysis } from '../src/core/parse.js';

function mutant(line: number, status: string, mutatorName = 'ConditionalExpression') {
  return {
    id: `${line}-${status}`,
    mutatorName,
    status,
    location: { start: { line, column: 1 }, end: { line, column: 9 } },
  };
}

function report(mutants: unknown[], path = 'src/calculator.ts') {
  return JSON.stringify({
    schemaVersion: '2.0',
    thresholds: { high: 80, low: 60 },
    files: { [path]: { language: 'typescript', source: '// ...', mutants } },
  });
}

function marks(mutants: unknown[], showPartial = true) {
  return mutationMarks(parseMutation(report(mutants)).files[0]!, { showPartial });
}

describe('parseMutation', () => {
  it('groups mutants by the line they start on', () => {
    const parsed = parseMutation(
      report([mutant(3, 'Killed'), mutant(3, 'Survived'), mutant(9, 'Killed')]),
    );

    expect(parsed.files[0]!.path).toBe('src/calculator.ts');
    expect(parsed.files[0]!.lines.get(3)).toHaveLength(2);
    expect(parsed.files[0]!.lines.get(9)).toHaveLength(1);
  });

  it('captures the schema version', () => {
    expect(parseMutation(report([mutant(1, 'Killed')])).schemaVersion).toBe('2.0');
  });

  it('keeps the mutator name, which is the actionable part', () => {
    const parsed = parseMutation(report([mutant(1, 'Survived', 'EqualityOperator')]));

    expect(parsed.files[0]!.lines.get(1)![0]!.mutator).toBe('EqualityOperator');
  });

  it('drops mutants with an unrecognised status rather than guessing', () => {
    const parsed = parseMutation(report([mutant(1, 'Killed'), mutant(2, 'SomethingNew')]));

    expect(parsed.files[0]!.lines.has(2)).toBe(false);
  });

  it('drops mutants with no usable location', () => {
    const parsed = parseMutation(
      report([mutant(1, 'Killed'), { id: 'x', mutatorName: 'm', status: 'Killed' }]),
    );

    expect(parsed.files[0]!.lines.size).toBe(1);
  });

  it('skips files with no mutants array', () => {
    const parsed = parseMutation(
      JSON.stringify({ schemaVersion: '1', thresholds: {}, files: { 'a.ts': { language: 'ts' } } }),
    );

    expect(parsed.files).toEqual([]);
  });

  it('rejects a payload with no files object', () => {
    expect(() => parseMutation('{"schemaVersion":"1"}')).toThrow(/"files"/);
  });

  it('rejects a JSON array', () => {
    expect(() => parseMutation('[]')).toThrow(/JSON object/);
  });
});

describe('mutationMarks', () => {
  it('marks a line whose mutants were all killed as good', () => {
    expect(marks([mutant(1, 'Killed'), mutant(1, 'Killed')]).get(1)!.status).toBe('good');
  });

  it('treats a timeout as a detection, matching how the score is computed', () => {
    // A mutant that hangs the suite has been caught just as surely as one that fails.
    expect(marks([mutant(1, 'Timeout')]).get(1)!.status).toBe('good');
  });

  it('marks a line whose mutants all survived as bad', () => {
    expect(marks([mutant(1, 'Survived')]).get(1)!.status).toBe('bad');
  });

  it('marks an uncovered mutant as bad', () => {
    expect(marks([mutant(1, 'NoCoverage')]).get(1)!.status).toBe('bad');
  });

  it('marks a line with both killed and surviving mutants as partial', () => {
    // This is the case line coverage cannot see: the line ran, so coverage calls it
    // green, yet some of its behaviour is untested.
    expect(marks([mutant(1, 'Killed'), mutant(1, 'Survived')]).get(1)!.status).toBe('partial');
  });

  it('folds partial into good when the option is off', () => {
    expect(marks([mutant(1, 'Killed'), mutant(1, 'Survived')], false).get(1)!.status).toBe('good');
  });

  it('emits no mark when every mutant on the line failed to compile', () => {
    // That says something about the mutation run, not about the tests.
    expect(marks([mutant(1, 'CompileError'), mutant(1, 'RuntimeError')]).has(1)).toBe(false);
  });

  it('emits no mark for ignored or pending mutants', () => {
    expect(marks([mutant(1, 'Ignored'), mutant(1, 'Pending')]).has(1)).toBe(false);
  });

  it('ignores unscoreable mutants when classifying the rest of the line', () => {
    expect(marks([mutant(1, 'Killed'), mutant(1, 'CompileError')]).get(1)!.status).toBe('good');
  });

  it('reports how many mutants were killed', () => {
    const tooltip = marks([mutant(1, 'Killed'), mutant(1, 'Survived')]).get(1)!.tooltip;

    expect(tooltip).toContain('1/2 mutants killed');
  });

  it('names the surviving mutator, which says what test is missing', () => {
    const tooltip = marks([mutant(1, 'Survived', 'EqualityOperator')]).get(1)!.tooltip;

    expect(tooltip).toContain('EqualityOperator');
  });

  it('distinguishes "not covered" from "survived" in the tooltip', () => {
    expect(marks([mutant(1, 'NoCoverage')]).get(1)!.tooltip).toContain('not covered');
    expect(marks([mutant(1, 'Survived')]).get(1)!.tooltip).toContain('survived');
  });

  it('mentions mutants that were not scored', () => {
    expect(marks([mutant(1, 'Killed'), mutant(1, 'Ignored')]).get(1)!.tooltip).toContain(
      '1 not scored',
    );
  });
});

describe('mutationSummary', () => {
  it('scores detected mutants over all scoreable ones', () => {
    const file = parseMutation(
      report([
        mutant(1, 'Killed'),
        mutant(2, 'Timeout'),
        mutant(3, 'Survived'),
        mutant(4, 'NoCoverage'),
      ]),
    ).files[0]!;

    expect(mutationSummary(file)).toEqual({ percent: 50, label: 'mutants killed' });
  });

  it('excludes errored and ignored mutants from the score', () => {
    // Stryker computes its score the same way; including them would punish a file for
    // the mutation tool's own failures.
    const file = parseMutation(
      report([mutant(1, 'Killed'), mutant(2, 'CompileError'), mutant(3, 'Ignored')]),
    ).files[0]!;

    expect(mutationSummary(file).percent).toBe(100);
  });

  it('reports null when nothing could be scored', () => {
    const file = parseMutation(report([mutant(1, 'CompileError')])).files[0]!;

    expect(mutationSummary(file).percent).toBeNull();
  });
});

describe('mutationAnalysis', () => {
  it('presents itself as a mutation report', () => {
    expect(mutationAnalysis(parseMutation(report([mutant(1, 'Killed')]))).kind).toBe('mutation');
  });

  it('exposes marks and a summary per file', () => {
    const analysis = mutationAnalysis(parseMutation(report([mutant(1, 'Killed')])));

    expect(analysis.files[0]!.path).toBe('src/calculator.ts');
    expect(analysis.files[0]!.marks({ showPartial: true }).get(1)!.status).toBe('good');
    expect(analysis.files[0]!.summary().label).toBe('mutants killed');
  });
});

describe('detectKind', () => {
  it('recognises a mutation report', () => {
    expect(detectKind(report([mutant(1, 'Killed')]))).toBe('mutation');
  });

  it('does not mistake Istanbul coverage for a mutation report', () => {
    // Both are top-level objects keyed by file path, so this is the ordering hazard.
    const istanbul = JSON.stringify({
      'a.ts': { statementMap: { '0': { start: { line: 1 } } }, s: { '0': 1 } },
    });

    expect(detectKind(istanbul)).toBe('coverage');
  });

  it('does not mistake a mutation report for Istanbul coverage', () => {
    expect(detectKind(report([mutant(1, 'Killed')]), 'mutation-report.json')).toBe('mutation');
  });

  it.each([
    ['lcov', 'SF:a.ts\nDA:1,1\nend_of_record\n'],
    ['cobertura', '<coverage><packages><package><classes/></package></packages></coverage>'],
  ])('recognises %s as coverage', (_name, text) => {
    expect(detectKind(text)).toBe('coverage');
  });

  it('returns null for something unrecognisable', () => {
    expect(detectKind('hello world')).toBeNull();
  });
});

describe('parseAnalysis', () => {
  it('routes a mutation report to the mutation producer', () => {
    expect(parseAnalysis(report([mutant(1, 'Survived')])).kind).toBe('mutation');
  });

  it('routes an LCOV report to the coverage producer', () => {
    expect(parseAnalysis('SF:a.ts\nDA:1,1\nend_of_record\n').kind).toBe('coverage');
  });

  it('names both kinds when it cannot tell what it was given', () => {
    expect(() => parseAnalysis('nonsense')).toThrow(/mutation-testing-elements/);
  });
});

describe('looksLikeMutation', () => {
  it('needs both files and mutants to be confident', () => {
    expect(looksLikeMutation('{"files":{}}')).toBe(false);
    expect(looksLikeMutation(report([mutant(1, 'Killed')]))).toBe(true);
  });

  it('rejects non-JSON', () => {
    expect(looksLikeMutation('SF:a.ts')).toBe(false);
    expect(looksLikeMutation('<coverage/>')).toBe(false);
  });
});
