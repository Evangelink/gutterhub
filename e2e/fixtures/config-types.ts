/**
 * Project-level options surfaced to `playwright.config.ts`, kept in a type-only module so
 * the config does not pull in the full harness (and its Node/Playwright imports) at
 * config-evaluation time.
 */
export interface GutterHubTestOptions {
  /** Block all real network and serve github.com from saved markup. */
  offline: boolean;
  /** Chromium build to drive: `chromium` (default), `msedge`, or `chrome`. */
  browserChannel: string;
}
