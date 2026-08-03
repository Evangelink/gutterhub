/**
 * Builds the extension for Chrome and Firefox.
 *
 * Everything is bundled as IIFE: content scripts cannot be modules, Firefox's MV3
 * background page is an event page rather than a service worker, and a single output
 * format keeps the two targets byte-identical apart from the manifest.
 */

import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { buildManifest } from './manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['chrome', 'firefox'];

const args = process.argv.slice(2);
const watch = args.includes('--watch');
const requested = args.find((arg) => arg.startsWith('--target='))?.split('=')[1];
const targets = requested ? [requested] : TARGETS;

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const ENTRY_POINTS = {
  content: 'src/content/index.ts',
  background: 'src/background/index.ts',
  popup: 'src/ui/popup.ts',
  options: 'src/ui/options.ts',
};

for (const target of targets) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}". Expected one of: ${TARGETS.join(', ')}.`);
  }
}

async function buildTarget(target) {
  const outdir = join(ROOT, 'dist', target);
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const options = {
    entryPoints: Object.fromEntries(
      Object.entries(ENTRY_POINTS).map(([name, file]) => [name, join(ROOT, file)]),
    ),
    outdir,
    bundle: true,
    format: 'iife',
    target: ['chrome111', 'firefox115'],
    platform: 'browser',
    sourcemap: watch ? 'inline' : false,
    minify: !watch,
    legalComments: 'none',
    logLevel: 'info',
  };

  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
  } else {
    await esbuild.build(options);
  }

  writeFileSync(
    join(outdir, 'manifest.json'),
    `${JSON.stringify(buildManifest({ version, target }), null, 2)}\n`,
  );

  cpSync(join(ROOT, 'assets'), join(outdir, 'assets'), { recursive: true });
  cpSync(join(ROOT, 'src/content/overlay.css'), join(outdir, 'overlay.css'));
  cpSync(join(ROOT, 'src/ui/popup.html'), join(outdir, 'popup.html'));
  cpSync(join(ROOT, 'src/ui/options.html'), join(outdir, 'options.html'));
  cpSync(join(ROOT, 'src/ui/ui.css'), join(outdir, 'ui.css'));

  console.log(`built dist/${target} (version ${version})`);
}

for (const target of targets) {
  await buildTarget(target);
}

if (watch) {
  console.log('watching for changes…');
}
