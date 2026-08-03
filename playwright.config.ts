import { defineConfig } from '@playwright/test';
import type { GutterHubTestOptions } from './e2e/fixtures/config-types.js';

/**
 * End-to-end configuration for the built extension.
 *
 * Two projects run against `dist/chrome`:
 *
 *   - **offline** is the deterministic PR gate. It blocks all real network and serves saved
 *     github.com markup from memory, so it never depends on github.com being up or on its
 *     markup staying still.
 *   - **live** is the canary. It drives real github.com and is the only check that the
 *     adapters still match GitHub's *current* markup. `npm run e2e` runs both, so the
 *     scheduled workflow stays a genuine canary; `npm run e2e:offline` runs only the gate.
 *
 * Firefox is intentionally not a project here. Playwright can load an unpacked extension
 * only into Chromium, via `--load-extension` on a persistent context; it exposes no
 * supported API in this version to install a temporary MV3 add-on into Firefox and reach
 * its background event page (that needs web-ext / the remote-debugging protocol, out of
 * scope for this suite). `dist/firefox` is still built and unit-tested, and is verified by
 * hand through about:debugging, but it is deliberately **not** claimed to be covered here.
 * See README "Development" for the manual Firefox check.
 *
 * Only Chromium is used, so no extra browser downloads are needed beyond the one Playwright
 * already installs.
 */
export default defineConfig<GutterHubTestOptions>({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 2,
  workers: process.env['CI'] ? 2 : undefined,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: 'artifacts/playwright-output',
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  use: {
    // Video is recorded by the harness (see e2e/fixtures/extension.ts), not here: the
    // extension needs a hand-launched persistent context, so Playwright's own video capture
    // (this `use.video` option) never runs. Trace and screenshot go through the normal page
    // machinery, so they stay config-driven and failure-only.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'offline',
      testMatch: /offline\.spec\.ts$/,
      use: { offline: true },
    },
    {
      name: 'live',
      testMatch: /live\.spec\.ts$/,
      use: { offline: false },
    },
  ],
});
