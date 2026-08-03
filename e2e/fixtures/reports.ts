/**
 * Report generators shared by the offline and live suites.
 *
 * These are the same shapes GutterHub meets in the wild — an LCOV file whose paths are
 * absolute CI paths, and a mutation report in the mutation-testing-elements schema — kept
 * in one place so the deterministic offline fixtures and the live canary exercise exactly
 * the same parsing and rendering pipeline.
 */

export interface ReportShape {
  /** Repository-relative path the report describes, e.g. `src/core/model.ts`. */
  path: string;
  /** Highest line number to emit. Offline fixtures pass a small count; live uses the default. */
  lines?: number;
}

/**
 * LCOV coverage report.
 *
 * The `SF:` line is deliberately an absolute CI path, so a pass also proves that suffix
 * matching maps build paths onto repository paths. Line 3 is uncovered, line 4 is
 * branch-partial, and every remaining line up to `lines` carries a `DA:` entry so a blob
 * view can assert that every rendered line receives exactly one mark.
 */
export function coverageReport({ path, lines = 300 }: ReportShape): string {
  const out = [
    'TN:',
    `SF:/home/runner/work/gutterhub/gutterhub/${path}`,
    'DA:1,5',
    'DA:2,5',
    'DA:3,0',
    'DA:4,7',
    'BRDA:4,0,0,7',
    'BRDA:4,0,1,-',
  ];

  for (let line = 5; line <= lines; line++) {
    out.push(`DA:${line},${line % 3 === 0 ? 0 : line}`);
  }

  out.push('end_of_record', '');
  return out.join('\n');
}

/**
 * Mutation report in the mutation-testing-elements schema.
 *
 * Line 1 is all killed, line 2 mixed (the case coverage cannot see), line 3 survived, and
 * lines from 4 up to `lines` alternate. It mentions fewer lines than the coverage report,
 * so overlaying the two lights up disagreements — a covered line whose mutants survived.
 */
export function mutationReport({ path, lines = 140 }: ReportShape): string {
  const mutants: Array<{
    id: string;
    mutatorName: string;
    status: string;
    location: { start: { line: number; column: number }; end: { line: number; column: number } };
  }> = [];
  let id = 0;

  const push = (line: number, status: string): void => {
    mutants.push({
      id: String(id++),
      mutatorName: status === 'Survived' ? 'EqualityOperator' : 'ConditionalExpression',
      status,
      location: { start: { line, column: 1 }, end: { line, column: 20 } },
    });
  };

  push(1, 'Killed');
  push(1, 'Killed');
  push(2, 'Killed');
  push(2, 'Survived');
  push(3, 'Survived');

  for (let line = 4; line <= lines; line++) {
    push(line, line % 4 === 0 ? 'Survived' : 'Killed');
  }

  return JSON.stringify({
    schemaVersion: '2.0',
    thresholds: { high: 80, low: 60 },
    files: { [path]: { language: 'typescript', source: '// omitted', mutants } },
  });
}
