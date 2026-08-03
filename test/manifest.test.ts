import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS module shared with the build script, no types needed.
import { buildManifest, NAME, SHORT_NAME, DESCRIPTION } from '../scripts/manifest.mjs';

const chrome = buildManifest({ version: '1.2.3', target: 'chrome' });
const firefox = buildManifest({ version: '1.2.3', target: 'firefox' });

describe('store metadata', () => {
  it('fits the Chrome Web Store name limit', () => {
    expect(NAME.length).toBeLessThanOrEqual(75);
  });

  it('fits the stricter add-ons name limit', () => {
    expect(NAME.length).toBeLessThanOrEqual(50);
  });

  it('fits the Chrome Web Store description limit', () => {
    expect(DESCRIPTION.length).toBeLessThanOrEqual(132);
  });

  it('fits the short_name limit', () => {
    expect(SHORT_NAME.length).toBeLessThanOrEqual(12);
  });

  it('carries the words people actually search for', () => {
    // Store discovery is keyword search; a brand-only name is invisible.
    const haystack = `${NAME} ${DESCRIPTION}`.toLowerCase();

    for (const keyword of ['coverage', 'github', 'mutation', 'lcov', 'cobertura']) {
      expect(haystack).toContain(keyword);
    }
  });
});

describe('buildManifest', () => {
  it('targets manifest v3 for both browsers', () => {
    expect(chrome.manifest_version).toBe(3);
    expect(firefox.manifest_version).toBe(3);
  });

  it('gives Chrome a service worker', () => {
    expect(chrome.background).toEqual({ service_worker: 'background.js' });
  });

  it('gives Firefox an event page, which is what it supports', () => {
    expect(firefox.background).toEqual({ scripts: ['background.js'] });
  });

  it('sets a Gecko id, without which Firefox refuses to install', () => {
    expect(firefox.browser_specific_settings.gecko.id).toMatch(/@/);
  });

  it('omits Gecko settings from the Chrome manifest', () => {
    expect(chrome.browser_specific_settings).toBeUndefined();
  });

  it('propagates the version', () => {
    expect(chrome.version).toBe('1.2.3');
  });

  it('requests only github.com and the API up front', () => {
    // Anything broader makes the install prompt look far more invasive than it is.
    expect(chrome.host_permissions).toEqual(['https://github.com/*', 'https://api.github.com/*']);
  });

  it('defers arbitrary hosts to an optional permission', () => {
    expect(chrome.optional_host_permissions).toContain('https://*/*');
  });

  it('asks for storage and nothing else', () => {
    expect(chrome.permissions).toEqual(['storage']);
  });

  it('registers the content script and its styles', () => {
    expect(chrome.content_scripts[0].js).toEqual(['content.js']);
    expect(chrome.content_scripts[0].css).toEqual(['overlay.css']);
  });

  it('exposes a popup and an options page for both targets', () => {
    for (const manifest of [chrome, firefox]) {
      expect(manifest.action.default_popup).toBe('popup.html');
      expect(manifest.options_ui.page).toBe('options.html');
    }
  });

  it('keeps the brand, not the keyword-laden name, on the toolbar button', () => {
    expect(chrome.action.default_title).toBe(SHORT_NAME);
  });
});
