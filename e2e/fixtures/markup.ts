/**
 * Saved, representative GitHub markup for the offline suite.
 *
 * These are trimmed but faithful copies of what github.com serves today: the React file
 * view lays a file out as two sibling columns that **both** carry `data-line-number`, and
 * the "Files changed" / commit diff is a table whose new-file line numbers are the
 * `js-blob-rnum` cells with deletion rows interleaved. Serving them from memory lets the
 * offline suite drive the whole content-script pipeline while making no request to
 * github.com at all.
 */

const REPOSITORY = 'Evangelink/gutterhub';

/** Wraps fixture markup in a minimal, self-contained HTML document (no external assets). */
function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    `<title>${title}</title>`,
    '</head>',
    '<body class="logged-in">',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/**
 * React-rendered single-file blob view with `count` lines.
 *
 * The page carries no path attribute — exactly like github.com — so the content script has
 * to take the path from the URL. Numbers live in `.react-line-numbers` and code in
 * `.react-code-lines`, and both columns repeat `data-line-number`.
 */
export function reactBlobPage(count: number): string {
  const numbers: string[] = [];
  const code: string[] = [];

  for (let line = 1; line <= count; line++) {
    numbers.push(
      `<div class="react-line-number react-code-text" data-line-number="${line}">${line}</div>`,
    );
    code.push(
      `<div class="react-file-line html-div" data-line-number="${line}">const value${line} = compute(${line});</div>`,
    );
  }

  const body = `
<div class="application-main">
  <div class="react-code-file-contents">
    <div class="react-line-numbers">
      ${numbers.join('\n      ')}
    </div>
    <div class="react-code-lines">
      ${code.join('\n      ')}
    </div>
  </div>
</div>`;

  return page(`calculator.ts · ${REPOSITORY}`, body);
}

/**
 * Table-based diff, as served on the "Files changed" tab and on a commit page.
 *
 * New-file line numbers are the `js-blob-rnum` cells; the deletion row's right-hand cell is
 * a `blob-num-deletion` blank, so an adapter that reads the *last* numbered cell must skip
 * it. New-file lines run 1..8, which the coverage fixture covers in full.
 */
export function diffPage(): string {
  const body = `
<div class="application-main">
  <div id="files">
    <div class="file js-file" data-tagsearch-path="src/calculator.ts">
      <div class="file-header">
        <div class="file-info"><a title="src/calculator.ts">src/calculator.ts</a></div>
      </div>
      <div class="js-file-content">
        <table class="diff-table js-diff-table tab-size">
          <tbody>
            <tr>
              <td class="blob-num blob-num-hunk"></td>
              <td class="blob-num blob-num-hunk"></td>
              <td class="blob-code blob-code-hunk">@@ -1,6 +1,8 @@</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-context js-blob-rlno" data-line-number="1"></td>
              <td class="blob-num blob-num-context js-blob-rnum" data-line-number="1"></td>
              <td class="blob-code blob-code-context">export function add(a, b) {</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-addition empty-cell"></td>
              <td class="blob-num blob-num-addition js-blob-rnum" data-line-number="2"></td>
              <td class="blob-code blob-code-addition">  const total = a + b;</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-addition empty-cell"></td>
              <td class="blob-num blob-num-addition js-blob-rnum" data-line-number="3"></td>
              <td class="blob-code blob-code-addition">  return total;</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-deletion js-blob-rlno" data-line-number="4"></td>
              <td class="blob-num blob-num-deletion empty-cell"></td>
              <td class="blob-code blob-code-deletion">  return a - b;</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-context js-blob-rlno" data-line-number="4"></td>
              <td class="blob-num blob-num-context js-blob-rnum" data-line-number="4"></td>
              <td class="blob-code blob-code-context">}</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-addition empty-cell"></td>
              <td class="blob-num blob-num-addition js-blob-rnum" data-line-number="5"></td>
              <td class="blob-code blob-code-addition">export function sub(a, b) {</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-addition empty-cell"></td>
              <td class="blob-num blob-num-addition js-blob-rnum" data-line-number="6"></td>
              <td class="blob-code blob-code-addition">  return a - b;</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-context js-blob-rlno" data-line-number="7"></td>
              <td class="blob-num blob-num-context js-blob-rnum" data-line-number="7"></td>
              <td class="blob-code blob-code-context">}</td>
            </tr>
            <tr>
              <td class="blob-num blob-num-addition empty-cell"></td>
              <td class="blob-num blob-num-addition js-blob-rnum" data-line-number="8"></td>
              <td class="blob-code blob-code-addition">export const version = 2;</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;

  return page(`Files changed · ${REPOSITORY}`, body);
}

/** How many new-file lines {@link diffPage} exposes (context + addition rows). */
export const DIFF_NEW_FILE_LINES = 8;
