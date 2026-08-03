# GutterHub — Code Coverage for GitHub

Line-by-line test coverage, drawn straight onto GitHub.

GutterHub paints a green, amber or red bar next to every line of code on **pull request
diffs**, **file views** and **commits** — the same thing Azure DevOps shows natively for
pull request code coverage, and what GitLab shows in its diff view.

It is **vendor-neutral**: it reads plain coverage reports, so it works with whatever your
CI already produces. No account, no SaaS, no uploading your coverage anywhere.

![Coverage gutters on a GitHub file view](docs/images/file-view.png)

## Status

Early. The core is tested and the extension builds for Chrome and Firefox, but it has not
been published to the extension stores yet — install it unpacked (below).

## Why this exists

| Option                                                                    | Vendor-neutral  | PR diffs                   | File views | Chrome   | Firefox |
| ------------------------------------------------------------------------- | --------------- | -------------------------- | ---------- | -------- | ------- |
| [Codecov extension](https://github.com/codecov/codecov-browser-extension) | ✗ needs Codecov | ✓                          | ✓          | ✓        | ✓       |
| [coverage-lens](https://github.com/ishay3000/coverage-lens)               | ✓               | ✓                          | ✗          | unpacked | ✓       |
| GitHub Code Quality                                                       | ✓               | file-level PR comment only | ✗          | n/a      | n/a     |
| **GutterHub**                                                             | ✓               | ✓                          | ✓          | ✓        | ✓       |

Coveralls, SonarQube Cloud, Codacy and Qlty ship no browser extension at all — their
line-level views live inside their own web UI.

## Supported report formats

| Format                                    | Produced by                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| **LCOV** (`lcov.info`)                    | `lcov`/`gcov`, Jest, Vitest, Karma, `cargo-llvm-cov`, Go via `gcov2lcov`, …                 |
| **Cobertura XML**                         | `coverlet`, `dotnet-coverage`, `pytest-cov`, JaCoCo (via converter), `gocover-cobertura`, … |
| **Istanbul JSON** (`coverage-final.json`) | `nyc`, Jest, Vitest                                                                         |

Branch data is used where the format provides it, so a line that ran but never took one of
its branches is shown in amber rather than being passed off as covered.

## Where the coverage comes from

Pick one per repository:

1. **GitHub Actions artifact** — GutterHub finds the workflow run for the commit you are
   looking at, downloads the matching artifact and reads the report out of it. Needs a
   token, because artifact downloads are authenticated even for public repositories.
2. **URL** — any reachable URL, built from a template:
   `https://ci.example.com/{owner}/{repo}/{sha}/lcov.info`.
   Placeholders: `{owner}` `{repo}` `{sha}` `{shortSha}` `{ref}` `{branch}` `{pr}` `{host}` `{path}`.
3. **Uploaded by hand** — paste or drop a report into the popup. Good for trying it out, for
   looking at coverage before you push, and for CI systems with nothing publicly reachable.

## Install

Not yet on the Chrome Web Store or AMO. To run it now:

```sh
git clone https://github.com/Evangelink/gutterhub
cd gutterhub
npm ci
npm run build
```

**Chrome / Edge** — go to `chrome://extensions`, turn on _Developer mode_, choose
_Load unpacked_, and select `dist/chrome`.

**Firefox** — go to `about:debugging#/runtime/this-firefox`, choose
_Load Temporary Add-on_, and select `dist/firefox/manifest.json`.

Then open a pull request, click the GutterHub icon and choose where your coverage lives.

## Path mapping

Coverage reports rarely spell paths the way GitHub does. A report may say
`/home/runner/work/repo/repo/src/app.ts`, `D:\a\1\s\src\App.cs`, `packages/app/src/main.ts`
or just `Adder.cs`, while GitHub only knows `src/app.ts`.

GutterHub matches on the **longest common path suffix** and requires one of the two paths
to be fully consumed, so `a/b/Foo.cs` never picks up coverage from `x/b/Foo.cs`. That
handles most reports with no configuration. When it does not, the options page offers a
prefix to strip, a prefix to add, and case-insensitive matching.

![GutterHub settings](docs/images/options.png)

## Permissions

| Permission                 | Why                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `storage`                  | Remembers your settings and any report you upload by hand.                                  |
| `https://github.com/*`     | Draws the overlay.                                                                          |
| `https://api.github.com/*` | Resolves the pull request head commit and downloads artifacts.                              |
| optional `https://*/*`     | Only requested if you point GutterHub at your own coverage URL or a GitHub Enterprise host. |

Your token is kept in extension storage and is only ever sent to the GitHub host you are
browsing. Coverage reports are fetched by the extension and never leave your machine.

## Development

```sh
npm ci
npm run verify     # typecheck + tests + build
npm run watch      # rebuild on change
npm run test       # unit and DOM tests
npm run e2e        # load the built extension in Chromium against live GitHub
npm run package    # store-ready zips in artifacts/
```

`npm run e2e` is the check that matters most. It loads `dist/chrome` into a real browser,
seeds a report, opens a live GitHub page and asserts that the markers land where they
should. It is what caught the modern code view annotating every line twice. Point it at a
diff as well with `GUTTERHUB_E2E_PR=<pull request files url> npm run e2e`.

Icons are generated, not committed as opaque binaries: `node scripts/generate-icons.mjs`.

### Layout

```
src/core/        report parsing, path matching, and coverage → renderable marks
src/providers/   where reports come from (Actions artifact, URL, manual)
src/github/      page detection, DOM adapters, the renderer
src/content/     orchestration: navigation, mutation handling, re-rendering
src/background/  fetching and caching, away from the page's CORS policy
src/ui/          popup and options
```

### Scope: a coverage product on a general engine

Roughly three quarters of the code has no idea what coverage is. The DOM adapters, page
detection, navigation handling, path matching and the fetch/cache layer only ever deal in
_"put a coloured mark and a tooltip on line N of file F"_. Coverage is one producer of
those marks:

```
coverage report → parsers → FileCoverage → coverageMarks() → LineMark[] → renderer → DOM
                            └─ coverage-specific ─┘          └────── knows nothing about coverage ──────┘
```

`src/github/` imports `LineMark` as a **type only**, so it has no runtime dependency on
the coverage model at all. A second kind of annotation — mutation testing is the obvious
one, since killed/survived/no-coverage maps straight onto the three visual states — would
be a new producer of `LineMark`s, not a change to the renderer or the adapters.

That seam exists because it was nearly free. There is deliberately **no plugin system**:
a framework with one implementation is a maintenance burden with no users. The product is
coverage, and the name says so, because extension discovery is keyword search.

### On surviving GitHub's markup

The original Codecov extension was archived after years of chasing GitHub's HTML; its
last functional commit is literally _"fix gh compare bc new html classes"_. GutterHub
treats that as a design constraint rather than an accident:

- DOM knowledge is confined to `src/github/adapters/`, one adapter per rendering.
- Adapters are tried in order and the last one matches on `data-line-number` alone, so an
  unfamiliar layout still gets annotated. There is a test that feeds it markup no adapter
  was written for.
- Markers are drawn with inset box-shadows, never borders or extra cells, so nothing
  reflows and no table layout is disturbed.
- A file with no matching coverage is left completely untouched, because a half-painted
  diff reads as "this code is untested" rather than "no data".
- `node scripts/probe.mjs <github url>` dumps what a live page actually looks like —
  which selectors match, how many elements carry `data-line-number`, and whether any
  path attribute is present. Start there when the overlay stops appearing.

## Licence

[MIT](LICENSE)

Store listing copy lives in [`docs/store-listing.md`](docs/store-listing.md).
