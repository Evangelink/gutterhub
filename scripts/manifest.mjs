/**
 * Shared manifest definition.
 *
 * Chrome and Firefox disagree about MV3 background pages: Chrome wants a service worker,
 * Firefox wants an event page. Rather than maintaining two hand-written manifests that
 * drift apart, both are generated from this one description.
 */

/**
 * Store name and description.
 *
 * Extension discovery is almost entirely keyword search — people look for "code coverage
 * github", not for a brand they have never heard of. Both fields are indexed, so the name
 * carries the primary keyword and `short_name` keeps the brand where space is tight.
 *
 * Coverage stays in the name even though mutation testing is supported too: it is the
 * term people search for, and diluting it for a secondary feature would cost more
 * installs than the extra honesty gains. The description carries the full story.
 * Limits: Chrome allows 75 characters for the name and 132 for the description.
 */
export const NAME = 'GutterHub — Code Coverage for GitHub';
export const SHORT_NAME = 'GutterHub';
export const DESCRIPTION =
  'Test coverage and mutation testing, line by line, on GitHub pull requests, ' +
  'file views and commits. LCOV, Cobertura, Stryker.';

/** @param {{ version: string, target: 'chrome' | 'firefox' }} options */
export function buildManifest({ version, target }) {
  const icons = {
    16: 'assets/icon-16.png',
    32: 'assets/icon-32.png',
    48: 'assets/icon-48.png',
    128: 'assets/icon-128.png',
  };

  /** @type {Record<string, unknown>} */
  const manifest = {
    manifest_version: 3,
    name: NAME,
    short_name: SHORT_NAME,
    version,
    description: DESCRIPTION,
    homepage_url: 'https://github.com/Evangelink/gutterhub',
    icons,
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
    // Coverage can be hosted anywhere, Azure DevOps is its own host, and GitHub
    // Enterprise lives on private hosts. Requesting those up front would make the
    // extension look far more invasive than it is, so they are asked for only when a
    // user configures them. `dev.azure.com` is listed explicitly as well as being
    // covered by the wildcard, so the prompt a user sees names the actual service.
    optional_host_permissions: [
      'https://dev.azure.com/*',
      'https://*.dev.azure.com/*',
      // Artifacts are served from regional hosts, not from dev.azure.com.
      'https://*.artifacts.visualstudio.com/*',
      'https://*.visualstudio.com/*',
      'https://*/*',
      'http://*/*',
    ],
    content_scripts: [
      {
        matches: ['https://github.com/*'],
        js: ['content.js'],
        css: ['overlay.css'],
        run_at: 'document_idle',
      },
    ],
    action: {
      default_title: SHORT_NAME,
      default_popup: 'popup.html',
      default_icon: icons,
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  };

  if (target === 'firefox') {
    manifest.background = { scripts: ['background.js'] };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'gutterhub@evangelink.github.io',
        strict_min_version: '115.0',
      },
    };
  } else {
    manifest.background = { service_worker: 'background.js' };
  }

  return manifest;
}
