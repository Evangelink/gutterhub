import { describe, expect, it } from 'vitest';
import { looksLikeIstanbul, parseIstanbul } from '../src/core/parsers/istanbul.js';
import { lineStatus } from '../src/core/model.js';

function statement(line: number) {
  return { start: { line, column: 0 }, end: { line, column: 10 } };
}

const REPORT = JSON.stringify({
  '/repo/src/app.ts': {
    path: '/repo/src/app.ts',
    statementMap: { '0': statement(1), '1': statement(2), '2': statement(3) },
    s: { '0': 5, '1': 0, '2': 2 },
    branchMap: {
      '0': {
        loc: statement(3),
        type: 'if',
        locations: [statement(3), statement(3)],
      },
    },
    b: { '0': [2, 0] },
  },
});

describe('parseIstanbul', () => {
  it('maps statements onto their starting line', () => {
    const report = parseIstanbul(REPORT);

    expect(report.format).toBe('istanbul');
    expect(report.files[0]!.lines.get(1)!.hits).toBe(5);
    expect(report.files[0]!.lines.get(2)!.hits).toBe(0);
  });

  it('prefers the recorded path over the map key', () => {
    const report = parseIstanbul(
      JSON.stringify({
        key: { path: '/real/path.ts', statementMap: { '0': statement(1) }, s: { '0': 1 } },
      }),
    );

    expect(report.files[0]!.path).toBe('/real/path.ts');
  });

  it('falls back to the map key when no path is recorded', () => {
    const report = parseIstanbul(
      JSON.stringify({ 'only/key.ts': { statementMap: { '0': statement(1) }, s: { '0': 1 } } }),
    );

    expect(report.files[0]!.path).toBe('only/key.ts');
  });

  it('takes the highest hit count when several statements share a line', () => {
    const report = parseIstanbul(
      JSON.stringify({
        'a.ts': {
          statementMap: { '0': statement(7), '1': statement(7) },
          s: { '0': 9, '1': 0 },
        },
      }),
    );

    // Summing would claim 9 executions of a line that ran once per statement pass, and
    // taking the minimum would wrongly paint an executed line as dead.
    expect(report.files[0]!.lines.get(7)!.hits).toBe(9);
  });

  it('records branch totals per line', () => {
    const line = parseIstanbul(REPORT).files[0]!.lines.get(3)!;

    expect(line.branches).toBe(2);
    expect(line.coveredBranches).toBe(1);
    expect(lineStatus(line)).toBe('partial');
  });

  it('marks a line covered when every branch was taken', () => {
    const report = parseIstanbul(
      JSON.stringify({
        'a.ts': {
          statementMap: { '0': statement(1) },
          s: { '0': 3 },
          branchMap: { '0': { loc: statement(1), locations: [statement(1), statement(1)] } },
          b: { '0': [1, 2] },
        },
      }),
    );

    expect(lineStatus(report.files[0]!.lines.get(1)!)).toBe('covered');
  });

  it('ignores branch entries whose line has no statement', () => {
    const report = parseIstanbul(
      JSON.stringify({
        'a.ts': {
          statementMap: { '0': statement(1) },
          s: { '0': 1 },
          branchMap: { '0': { loc: statement(99), locations: [statement(99)] } },
          b: { '0': [0] },
        },
      }),
    );

    expect(report.files[0]!.lines.has(99)).toBe(false);
    expect(report.files[0]!.lines.get(1)!.branches).toBeUndefined();
  });

  it('skips entries that are not coverage maps', () => {
    const report = parseIstanbul(JSON.stringify({ total: 42, 'a.ts': null }));

    expect(report.files).toEqual([]);
  });

  it('rejects a JSON array', () => {
    expect(() => parseIstanbul('[]')).toThrow(/JSON object/);
  });

  it('propagates malformed JSON', () => {
    expect(() => parseIstanbul('{')).toThrow();
  });
});

describe('looksLikeIstanbul', () => {
  it('accepts a coverage-final document', () => {
    expect(looksLikeIstanbul(REPORT)).toBe(true);
  });

  it('rejects a json-summary document, which has no line data', () => {
    expect(looksLikeIstanbul('{"total":{"lines":{"pct":80}}}')).toBe(false);
  });

  it('rejects XML and LCOV', () => {
    expect(looksLikeIstanbul('<coverage/>')).toBe(false);
    expect(looksLikeIstanbul('SF:a.ts')).toBe(false);
  });
});
