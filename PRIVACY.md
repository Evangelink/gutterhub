# Privacy policy for GutterHub

_Last updated: 3 August 2026_

GutterHub is a browser extension that overlays test coverage and mutation testing results
onto GitHub. This policy describes exactly what it does with your data.

## The short version

GutterHub does not collect, transmit, sell or share any personal data. There is no
analytics, no telemetry, no crash reporting and no backend server. Everything it stores
stays in your browser.

## What GutterHub stores

All of this is held in your browser's extension storage and never leaves your machine
except as described under "Network requests" below.

| What                                                                                                 | Where                                                        | Why                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Your per-repository settings — which report source to use, path-mapping options, display preferences | `chrome.storage.sync` (or `local` where sync is unavailable) | So your configuration persists and follows your browser profile          |
| A GitHub personal access token, if you choose to provide one                                         | `chrome.storage.sync`                                        | To read GitHub Actions artifacts and private repositories on your behalf |
| Coverage or mutation reports you upload by hand                                                      | `chrome.storage.local`                                       | So the overlay can be drawn without re-uploading the report              |

Nothing is written anywhere else. Uninstalling the extension removes all of it.

## Network requests

GutterHub makes network requests only to hosts you have implicitly or explicitly chosen:

- **The GitHub host you are browsing** (`github.com`, or a GitHub Enterprise host you
  configure) and its API, to resolve which commit a pull request points at and to
  download coverage artifacts.
- **A coverage report URL you configure yourself**, if you use the URL source.

Your token is sent only to the GitHub host you are browsing, as an `Authorization`
header, exactly as the GitHub API requires. It is never sent anywhere else, and never to
the extension's authors.

Reports are fetched by the extension, parsed in your browser, and discarded when you
navigate away. They are not uploaded anywhere.

## What GutterHub does not do

- No analytics, telemetry, usage tracking or fingerprinting
- No advertising, and no data sold or shared with third parties
- No remote code execution — all code is bundled in the published package, and nothing is
  downloaded and executed at runtime
- No reading or transmitting of page content beyond what is needed to draw the overlay,
  which happens entirely in your browser

## Permissions, and why each is needed

| Permission                     | Why                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`                      | Persists your settings and any report you upload by hand                                                                                         |
| `https://github.com/*`         | Draws the overlay, which requires a content script on GitHub pages                                                                               |
| `https://api.github.com/*`     | Resolves a pull request's head commit and downloads Actions artifacts                                                                            |
| Optional access to other sites | Requested **only** when you configure a coverage URL on your own infrastructure, or add a GitHub Enterprise host. Not requested at install time. |

## Children

GutterHub is a developer tool and is not directed at children.

## Changes

Any change to this policy will be committed to the repository, so the full history is
public and auditable at
<https://github.com/Evangelink/gutterhub/commits/main/PRIVACY.md>.

## Contact

Questions or concerns: open an issue at
<https://github.com/Evangelink/gutterhub/issues>.
