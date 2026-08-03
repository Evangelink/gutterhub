/** Zips each built target for store submission. */

import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function collect(directory, base = directory, files = {}) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      collect(full, base, files);
    } else {
      files[relative(base, full).replace(/\\/g, '/')] = new Uint8Array(readFileSync(full));
    }
  }
  return files;
}

mkdirSync(join(ROOT, 'artifacts'), { recursive: true });

for (const target of ['chrome', 'firefox']) {
  const source = join(ROOT, 'dist', target);
  try {
    statSync(source);
  } catch {
    console.error(`dist/${target} is missing — run "npm run build" first.`);
    process.exitCode = 1;
    continue;
  }

  const output = join(ROOT, 'artifacts', `gutterhub-${target}-${version}.zip`);
  const zipped = zipSync(collect(source), { level: 9 });
  createWriteStream(output).end(zipped);
  console.log(`${relative(ROOT, output)} (${(zipped.length / 1024).toFixed(1)} KiB)`);
}
