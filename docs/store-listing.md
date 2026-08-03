# Store listing copy

Source of truth for the Chrome Web Store and Firefox Add-ons listings. The name and
description here must match `scripts/manifest.mjs`, which `test/manifest.test.ts` enforces
along with the store length limits.

Discovery for a browser extension is almost entirely keyword search. Both the name and the
description are indexed, so the name carries the keywords people actually type — _"code
coverage github"_ — while `short_name` keeps the brand for places where space is tight.

Coverage stays in the **name** even though mutation testing is supported too: it is the
term people search for, and diluting it for a secondary feature would cost more installs
than the extra precision gains. The description carries the full story.

## Name

```
GutterHub — Code Coverage for GitHub
```

## Short description

```
Test coverage and mutation testing, line by line, on GitHub pull requests, file views and commits. LCOV, Cobertura, Stryker.
```

## Category

Developer Tools

## Full description

```
See exactly which lines your tests cover — and which of them your tests would not
notice breaking — without leaving GitHub.

GutterHub draws a green, amber or red bar next to every line of code on pull request
diffs, file views and commits — the same thing Azure DevOps shows natively for pull
request code coverage, and what GitLab shows in its diff view.

It is vendor-neutral. It reads the reports your CI already produces, so there
is no account to create, no service to sign up for, and your reports are never uploaded
anywhere. Everything is fetched by the extension and stays on your machine.

WHAT YOU GET

• Coverage marks on every line, on pull request diffs, file views and commits
• A per-file percentage in diff headers
• Amber marks for lines that ran but never took one of their branches, so partially
  tested code stops hiding behind a green bar
• Hover any line for its exact hit count and branch totals
• Mutation testing results in the same gutters, when you point it at a mutation report

SUPPORTED COVERAGE FORMATS

• LCOV — lcov/gcov, Jest, Vitest, Karma, cargo-llvm-cov, Go via gcov2lcov
• Cobertura XML — coverlet, dotnet-coverage, pytest-cov, JaCoCo via a converter,
  gocover-cobertura
• Istanbul JSON — nyc, Jest, Vitest

SUPPORTED MUTATION TESTING FORMATS

• mutation-testing-elements JSON — Stryker (JS/TS), Stryker.NET (C#), Stryker4s
  (Scala) and PIT (Java, via a converter)

The same three colours then mean killed, partly killed and survived. Amber is the
interesting one: a line where only some mutants were caught is code that line coverage
happily reports as fully covered. The report kind is detected automatically, so there
is nothing extra to configure.

WHERE THE REPORTS COME FROM

Choose one per repository:

• GitHub Actions artifact — GutterHub finds the workflow run for the commit you are
  looking at, downloads the matching artifact and reads the report out of it
• A URL — anything reachable, built from a template such as
  https://ci.example.com/{owner}/{repo}/{sha}/lcov.info
• Uploaded by hand — paste or drop a report into the popup, handy for checking coverage
  before you push

GitHub Enterprise is supported; GutterHub asks for permission for your host when you
add it.

PERMISSIONS

• Storage — remembers your settings and any report you upload by hand
• github.com and api.github.com — draws the overlay, resolves the pull request head
  commit and downloads artifacts
• Access to other sites is optional and only requested if you point GutterHub at your
  own coverage URL or a GitHub Enterprise host

Your token is kept in extension storage and is only ever sent to the GitHub host you are
browsing.

Open source and MIT licensed: https://github.com/Evangelink/gutterhub
```

## Screenshots

Store-ready assets come from `npm run screenshots` and `npm run icons`. Do not hand-crop
them: the stores reject anything that is not exactly the required size, and the capture
runs at `deviceScaleFactor: 2`, so `scale: 'css'` is what keeps them at CSS pixel
dimensions instead of silently doubling to 2560×1600.

| File                                    | Size     | Purpose                                         |
| --------------------------------------- | -------- | ----------------------------------------------- |
| `docs/store/screenshot-1-file-view.png` | 1280×800 | Coverage on a file view                         |
| `docs/store/screenshot-2-conflicts.png` | 1280×800 | Two reports overlaid, showing conflicts         |
| `docs/store/promo-440x280.png`          | 440×280  | Small promotional tile (**required** by Chrome) |
| `assets/icon-128.png`                   | 128×128  | Extension icon                                  |
| `docs/images/*.png`                     | varies   | README only — **not** store-legal sizes         |

## Submission checklist

### Chrome Web Store

- [ ] Developer account registered (one-off registration fee)
- [x] Package — `npm run package` produces `artifacts/gutterhub-chrome-<version>.zip`
- [x] 128×128 icon in the package
- [x] At least one 1280×800 or 640×400 screenshot
- [x] Small promotional tile, 440×280
- [x] Privacy policy written — [`PRIVACY.md`](../PRIVACY.md); the listing needs a public URL to it
- [ ] Privacy practices form: declare no data collection and justify each permission,
      using the wording below
- [ ] Decide what to do about `optional_host_permissions` — see the note at the end

### Firefox Add-ons (AMO)

- [x] Package — `npm run package` produces `artifacts/gutterhub-firefox-<version>.zip`
- [x] `browser_specific_settings.gecko.id` set in the manifest
- [ ] **Source code submission is mandatory.** The published bundle is minified by
      esbuild, and AMO requires reviewable sources plus build instructions whenever the
      submitted code is generated or minified. Provide the repository and:
      `npm ci && npm run build:firefox`, which produces `dist/firefox`.
- [ ] Privacy policy URL

### Microsoft Edge Add-ons

- [ ] Partner Center account
- [x] Package — the Chrome zip is accepted as-is
- [ ] Same listing copy, screenshots and privacy policy URL

### A note on `optional_host_permissions`

The manifest asks for `https://*/*` and `http://*/*` as **optional** permissions, so they
are never granted at install time. They are requested only if a user points GutterHub at a
coverage URL on their own infrastructure, or adds a GitHub Enterprise host.

Reviewers still scrutinise wildcard host permissions heavily, and this is the most likely
cause of a slow or rejected review. If that happens there are two routes: drop the
wildcard and request specific hosts through `chrome.permissions.request` at configuration
time — better posture, slightly more friction — or keep it and explain the above in the
justification. Worth deciding before the first submission rather than in reaction to a
rejection.

## Privacy justification

Reviewers ask why each permission is needed. Answers, in the form the forms expect:

- **storage** — persists the user's per-repository coverage source, display preferences
  and any report they upload by hand.
- **host permission for github.com** — the extension draws the coverage overlay directly
  onto GitHub pages, which requires a content script there.
- **host permission for api.github.com** — resolves the head commit of a pull request and
  downloads GitHub Actions artifacts containing coverage reports.
- **optional host permissions** — only requested when a user configures a coverage report
  URL on their own infrastructure, or adds a GitHub Enterprise host.
- **remote code** — none. Everything is bundled; nothing is fetched and executed.
- **data collection** — none. No analytics, no telemetry, no data leaves the user's
  machine except requests to the GitHub host and any coverage URL they configure.
