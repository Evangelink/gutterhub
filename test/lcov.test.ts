import { describe, expect, it } from 'vitest';
import { parseLcov, looksLikeLcov } from '../src/core/parsers/lcov.js';
import { lineStatus, summarise } from '../src/core/model.js';

const SIMPLE = `TN:
SF:src/calculator.ts
DA:1,3
DA:2,3
DA:3,0
DA:5,1
LF:4
LH:3
end_of_record
SF:src/index.ts
DA:1,1
end_of_record
`;

describe('parseLcov', () => {
  it('reads one entry per SF record', () => {
    const report = parseLcov(SIMPLE);

    expect(report.format).toBe('lcov');
    expect(report.files.map((file) => file.path)).toEqual(['src/calculator.ts', 'src/index.ts']);
  });

  it('keeps hit counts per line', () => {
    const [calculator] = parseLcov(SIMPLE).files;

    expect(calculator!.lines.get(1)).toMatchObject({ line: 1, hits: 3 });
    expect(calculator!.lines.get(3)).toMatchObject({ line: 3, hits: 0 });
    expect(calculator!.lines.get(5)).toMatchObject({ line: 5, hits: 1 });
  });

  it('does not invent lines that the report never mentions', () => {
    const [calculator] = parseLcov(SIMPLE).files;

    expect(calculator!.lines.has(4)).toBe(false);
    expect(calculator!.lines.size).toBe(4);
  });

  it('marks zero-hit lines as uncovered and positive ones as covered', () => {
    const [calculator] = parseLcov(SIMPLE).files;

    expect(lineStatus(calculator!.lines.get(3)!)).toBe('uncovered');
    expect(lineStatus(calculator!.lines.get(1)!)).toBe('covered');
  });

  it('folds BRDA records into per-line branch totals', () => {
    const report = parseLcov(`SF:a.ts
DA:10,5
BRDA:10,0,0,5
BRDA:10,0,1,-
end_of_record
`);

    const line = report.files[0]!.lines.get(10)!;
    expect(line.branches).toBe(2);
    expect(line.coveredBranches).toBe(1);
  });

  it('reports an executed line with an untaken branch as partial', () => {
    const report = parseLcov(`SF:a.ts
DA:10,5
BRDA:10,0,0,5
BRDA:10,0,1,-
end_of_record
`);

    expect(lineStatus(report.files[0]!.lines.get(10)!)).toBe('partial');
  });

  it('treats "-" as an untaken branch rather than a parse failure', () => {
    const report = parseLcov(`SF:a.ts
DA:1,1
BRDA:1,0,0,-
BRDA:1,0,1,-
end_of_record
`);

    expect(report.files[0]!.lines.get(1)!.coveredBranches).toBe(0);
  });

  it('sums duplicate DA records for the same line', () => {
    const report = parseLcov(`SF:a.ts
DA:1,2
DA:1,3
end_of_record
`);

    expect(report.files[0]!.lines.get(1)!.hits).toBe(5);
  });

  it('closes a trailing record that is missing end_of_record', () => {
    const report = parseLcov('SF:a.ts\nDA:1,1\n');

    expect(report.files).toHaveLength(1);
    expect(report.files[0]!.lines.size).toBe(1);
  });

  it('starts a new file when SF repeats without end_of_record', () => {
    const report = parseLcov('SF:a.ts\nDA:1,1\nSF:b.ts\nDA:2,0\n');

    expect(report.files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
    expect(report.files[1]!.lines.get(2)!.hits).toBe(0);
  });

  it('drops file records that carry no line data', () => {
    const report = parseLcov('SF:empty.ts\nFNF:0\nend_of_record\n');

    expect(report.files).toEqual([]);
  });

  it('tolerates CRLF tracefiles', () => {
    const report = parseLcov('SF:a.ts\r\nDA:1,4\r\nend_of_record\r\n');

    expect(report.files[0]!.lines.get(1)!.hits).toBe(4);
  });

  it('ignores records it does not understand', () => {
    const report = parseLcov(`SF:a.ts
FN:1,doThing
FNDA:2,doThing
DA:1,2
BRF:0
BRH:0
end_of_record
`);

    expect(report.files[0]!.lines.size).toBe(1);
  });

  it('returns an empty report for unrelated text instead of throwing', () => {
    expect(parseLcov('hello world').files).toEqual([]);
  });

  it('preserves paths containing spaces and colons', () => {
    const report = parseLcov('SF:C:/My Projects/a.ts\nDA:1,1\nend_of_record\n');

    expect(report.files[0]!.path).toBe('C:/My Projects/a.ts');
  });
});

describe('summarise', () => {
  it('counts covered, partial and uncovered lines separately', () => {
    const report = parseLcov(`SF:a.ts
DA:1,1
DA:2,0
DA:3,4
BRDA:3,0,0,4
BRDA:3,0,1,-
end_of_record
`);

    expect(summarise(report.files[0]!)).toEqual({
      coveredLines: 1,
      partialLines: 1,
      uncoveredLines: 1,
      totalLines: 3,
      percent: (2 / 3) * 100,
    });
  });

  it('reports a null percentage when nothing is instrumented', () => {
    expect(summarise({ path: 'a.ts', lines: new Map() }).percent).toBeNull();
  });
});

describe('looksLikeLcov', () => {
  it.each([['TN:\nSF:a.ts\n'], ['SF:a.ts\nDA:1,1\n']])('accepts %j', (text) => {
    expect(looksLikeLcov(text)).toBe(true);
  });

  it.each([['<coverage/>'], ['{"a":{}}'], ['']])('rejects %j', (text) => {
    expect(looksLikeLcov(text)).toBe(false);
  });
});
