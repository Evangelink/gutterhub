/**
 * Writes a sample mutation report for trying the extension out.
 *
 * Real mutation testing of this repo would mean running Stryker, which takes far longer
 * than a demo warrants. The statuses here are therefore invented — the *shape* is a
 * faithful `mutation-testing-elements` document, but do not read anything into which
 * lines are green. For real coverage, `npm run coverage` produces genuine data.
 *
 *   node scripts/sample-mutation-report.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'artifacts', 'demo');

/** Files to fabricate mutants for, with how many lines to cover. */
const TARGETS = [
  ['src/core/model.ts', 140],
  ['src/core/marks.ts', 30],
  ['src/core/pathMatch.ts', 190],
  ['src/core/mutation.ts', 110],
];

const MUTATORS = [
  'ConditionalExpression',
  'EqualityOperator',
  'LogicalOperator',
  'ArithmeticOperator',
  'BooleanLiteral',
];

const files = {};
let id = 0;

for (const [path, lineCount] of TARGETS) {
  const mutants = [];

  for (let line = 1; line <= lineCount; line++) {
    // Deterministic spread so the demo shows all three states, including the
    // mixed case that only mutation testing can reveal.
    const mod = line % 9;
    if (mod === 0) {
      continue;
    }

    const statuses =
      mod === 4
        ? ['Killed', 'Survived']
        : mod === 7
          ? ['Survived']
          : mod === 5
            ? ['NoCoverage']
            : ['Killed'];

    for (const status of statuses) {
      mutants.push({
        id: String(id++),
        mutatorName: MUTATORS[line % MUTATORS.length],
        replacement: '/* mutated */',
        status,
        location: { start: { line, column: 1 }, end: { line, column: 20 } },
      });
    }
  }

  files[path] = { language: 'typescript', source: '// source omitted for the sample', mutants };
}

mkdirSync(OUT, { recursive: true });
const target = join(OUT, 'sample-mutation-report.json');
writeFileSync(
  target,
  `${JSON.stringify({ schemaVersion: '2.0', thresholds: { high: 80, low: 60 }, files }, null, 2)}\n`,
);

console.log(`${target} (${Object.keys(files).length} files, ${id} mutants)`);
