import { describe, expect, it } from 'vitest';
import { coverageMarks } from '../src/core/marks.js';
import { parseLcov } from '../src/core/parsers/lcov.js';

function marks(lcov: string, showPartial = true) {
  return coverageMarks(parseLcov(lcov).files[0]!, { showPartial });
}

describe('coverageMarks', () => {
  it('maps hit lines to covered and zero-hit lines to uncovered', () => {
    const result = marks('SF:a.ts\nDA:1,3\nDA:2,0\nend_of_record\n');

    expect(result.get(1)!.status).toBe('covered');
    expect(result.get(2)!.status).toBe('uncovered');
  });

  it('emits no mark for lines the report never mentions', () => {
    const result = marks('SF:a.ts\nDA:1,1\nend_of_record\n');

    expect(result.has(2)).toBe(false);
    expect(result.size).toBe(1);
  });

  it('marks an executed line with an untaken branch as partial', () => {
    const result = marks('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n');

    expect(result.get(1)!.status).toBe('partial');
  });

  it('folds partial into covered when the option is off', () => {
    const result = marks('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n', false);

    expect(result.get(1)!.status).toBe('covered');
  });

  it('keeps uncovered lines uncovered when partial display is off', () => {
    const result = marks('SF:a.ts\nDA:1,0\nend_of_record\n', false);

    expect(result.get(1)!.status).toBe('uncovered');
  });

  it('describes the hit count', () => {
    expect(marks('SF:a.ts\nDA:1,7\nend_of_record\n').get(1)!.tooltip).toContain('7 hits');
  });

  it('says "1 hit" rather than "1 hits"', () => {
    const tooltip = marks('SF:a.ts\nDA:1,1\nend_of_record\n').get(1)!.tooltip;

    expect(tooltip).toContain('1 hit');
    expect(tooltip).not.toContain('1 hits');
  });

  it('reports branch counts', () => {
    const tooltip = marks('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n').get(
      1,
    )!.tooltip;

    expect(tooltip).toContain('1/2 branches');
  });

  it('explains why a partial line is not fully covered', () => {
    const tooltip = marks('SF:a.ts\nDA:1,4\nBRDA:1,0,0,4\nBRDA:1,0,1,-\nend_of_record\n').get(
      1,
    )!.tooltip;

    expect(tooltip).toMatch(/branches never taken/i);
  });

  it('says a line is not covered when it never ran', () => {
    expect(marks('SF:a.ts\nDA:1,0\nend_of_record\n').get(1)!.tooltip).toMatch(/not covered/i);
  });

  it('carries the line number on each mark', () => {
    expect(marks('SF:a.ts\nDA:9,1\nend_of_record\n').get(9)!.line).toBe(9);
  });

  it('produces nothing for a file with no line data', () => {
    expect(coverageMarks({ path: 'a.ts', lines: new Map() }, { showPartial: true }).size).toBe(0);
  });
});
