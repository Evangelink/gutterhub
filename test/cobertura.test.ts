import { describe, expect, it } from 'vitest';
import { looksLikeCobertura, parseCobertura } from '../src/core/parsers/cobertura.js';
import { lineStatus } from '../src/core/model.js';

const REPORT = `<?xml version="1.0" encoding="utf-8"?>
<coverage line-rate="0.75" version="1.9">
  <sources>
    <source>D:\\a\\1\\s\\src</source>
  </sources>
  <packages>
    <package name="Calc">
      <classes>
        <class name="Calc.Adder" filename="Calc/Adder.cs" line-rate="0.75">
          <lines>
            <line number="10" hits="4" branch="false" />
            <line number="11" hits="0" branch="false" />
            <line number="12" hits="6" branch="true" condition-coverage="50% (1/2)" />
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`;

describe('parseCobertura', () => {
  it('reads line hits from class elements', () => {
    const report = parseCobertura(REPORT);

    expect(report.format).toBe('cobertura');
    expect(report.files).toHaveLength(1);
    expect(report.files[0]!.path).toBe('Calc/Adder.cs');
    expect(report.files[0]!.lines.get(10)!.hits).toBe(4);
    expect(report.files[0]!.lines.get(11)!.hits).toBe(0);
  });

  it('captures the source roots', () => {
    expect(parseCobertura(REPORT).sources).toEqual(['D:\\a\\1\\s\\src']);
  });

  it('derives branch totals from condition-coverage', () => {
    const line = parseCobertura(REPORT).files[0]!.lines.get(12)!;

    expect(line.branches).toBe(2);
    expect(line.coveredBranches).toBe(1);
    expect(lineStatus(line)).toBe('partial');
  });

  it('merges classes that share a filename', () => {
    const report = parseCobertura(`<coverage><packages><package><classes>
      <class name="A" filename="src/Shared.cs"><lines><line number="1" hits="1"/></lines></class>
      <class name="B" filename="src/Shared.cs"><lines><line number="2" hits="3"/></lines></class>
    </classes></package></packages></coverage>`);

    expect(report.files).toHaveLength(1);
    expect(report.files[0]!.lines.size).toBe(2);
    expect(report.files[0]!.lines.get(2)!.hits).toBe(3);
  });

  it('sums hits when a line appears in two classes of the same file', () => {
    const report = parseCobertura(`<coverage><packages><package><classes>
      <class filename="src/Shared.cs"><lines><line number="1" hits="2"/></lines></class>
      <class filename="src/Shared.cs"><lines><line number="1" hits="5"/></lines></class>
    </classes></package></packages></coverage>`);

    expect(report.files[0]!.lines.get(1)!.hits).toBe(7);
  });

  it('decodes XML entities in filenames', () => {
    const report = parseCobertura(
      '<coverage><packages><package><classes>' +
        '<class filename="src/A&amp;B.cs"><lines><line number="1" hits="1"/></lines></class>' +
        '</classes></package></packages></coverage>',
    );

    expect(report.files[0]!.path).toBe('src/A&B.cs');
  });

  it('ignores condition-coverage when the branch attribute is false', () => {
    const report = parseCobertura(
      '<coverage><packages><package><classes><class filename="a.cs"><lines>' +
        '<line number="1" hits="1" branch="false" condition-coverage="50% (1/2)"/>' +
        '</lines></class></classes></package></packages></coverage>',
    );

    expect(report.files[0]!.lines.get(1)!.branches).toBeUndefined();
    expect(lineStatus(report.files[0]!.lines.get(1)!)).toBe('covered');
  });

  it('skips classes without a filename', () => {
    const report = parseCobertura(
      '<coverage><packages><package><classes>' +
        '<class name="orphan"><lines><line number="1" hits="1"/></lines></class>' +
        '</classes></package></packages></coverage>',
    );

    expect(report.files).toEqual([]);
  });

  it('is not confused by markup inside comments', () => {
    const report = parseCobertura(
      '<coverage><!-- <class filename="ghost.cs"><lines><line number="9" hits="0"/></lines></class> -->' +
        '<packages><package><classes><class filename="real.cs"><lines>' +
        '<line number="1" hits="1"/></lines></class></classes></package></packages></coverage>',
    );

    expect(report.files.map((file) => file.path)).toEqual(['real.cs']);
  });

  it('handles single-quoted attributes', () => {
    const report = parseCobertura(
      "<coverage><packages><package><classes><class filename='q.cs'><lines>" +
        "<line number='3' hits='2'/></lines></class></classes></package></packages></coverage>",
    );

    expect(report.files[0]!.path).toBe('q.cs');
    expect(report.files[0]!.lines.get(3)!.hits).toBe(2);
  });

  it('treats a missing hits attribute as zero rather than NaN', () => {
    const report = parseCobertura(
      '<coverage><packages><package><classes><class filename="a.cs"><lines>' +
        '<line number="1"/></lines></class></classes></package></packages></coverage>',
    );

    expect(report.files[0]!.lines.get(1)!.hits).toBe(0);
  });

  it('returns no files for an empty report', () => {
    expect(parseCobertura('<coverage><packages/></coverage>').files).toEqual([]);
  });
});

describe('looksLikeCobertura', () => {
  it('accepts a coverage document containing classes', () => {
    expect(looksLikeCobertura(REPORT)).toBe(true);
  });

  it('rejects LCOV and JSON', () => {
    expect(looksLikeCobertura('SF:a.ts\n')).toBe(false);
    expect(looksLikeCobertura('{"a":{"statementMap":{}}}')).toBe(false);
  });

  it('rejects a JaCoCo report, which uses a different root element', () => {
    expect(looksLikeCobertura('<report name="x"><package/></report>')).toBe(false);
  });
});
