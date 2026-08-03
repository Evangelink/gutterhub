/**
 * Markup samples mirroring GitHub's rendered output.
 *
 * They are deliberately verbose — including the wrapper elements, blank-line rows and
 * deletion rows that trip up naive selectors — so that the adapters are exercised against
 * something close to what they meet in the wild.
 */

/** Classic table-based unified diff on the pull request "Files changed" tab. */
export const LEGACY_UNIFIED_DIFF = `
<div id="files">
  <div class="file js-file" data-tagsearch-path="src/calculator.ts">
    <div class="file-header">
      <div class="file-info"><a title="src/calculator.ts">src/calculator.ts</a></div>
    </div>
    <div class="js-file-content">
      <table class="diff-table js-diff-table">
        <tbody>
          <tr>
            <td class="blob-num blob-num-hunk"></td>
            <td class="blob-num blob-num-hunk"></td>
            <td class="blob-code blob-code-hunk">@@ -1,4 +1,6 @@</td>
          </tr>
          <tr>
            <td class="blob-num blob-num-context" data-line-number="1"></td>
            <td class="blob-num blob-num-context" data-line-number="1"></td>
            <td class="blob-code blob-code-context">export function add(a, b) {</td>
          </tr>
          <tr>
            <td class="blob-num blob-num-deletion" data-line-number="2"></td>
            <td class="blob-num blob-num-deletion empty-cell"></td>
            <td class="blob-code blob-code-deletion">  return a - b;</td>
          </tr>
          <tr>
            <td class="blob-num blob-num-addition empty-cell"></td>
            <td class="blob-num blob-num-addition" data-line-number="2"></td>
            <td class="blob-code blob-code-addition">  return a + b;</td>
          </tr>
          <tr>
            <td class="blob-num blob-num-addition empty-cell"></td>
            <td class="blob-num blob-num-addition" data-line-number="3"></td>
            <td class="blob-code blob-code-addition">}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="file js-file" data-tagsearch-path="src/untested.ts">
    <div class="file-header"><div class="file-info"><a title="src/untested.ts">src/untested.ts</a></div></div>
    <table class="diff-table">
      <tbody>
        <tr>
          <td class="blob-num blob-num-addition empty-cell"></td>
          <td class="blob-num blob-num-addition" data-line-number="1"></td>
          <td class="blob-code blob-code-addition">export const nope = 1;</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

/** Classic single-file blob view. */
export const LEGACY_BLOB = `
<div class="Box mt-3 position-relative" data-tagsearch-path="src/calculator.ts">
  <table class="highlight tab-size js-file-line-container">
    <tbody>
      <tr>
        <td id="L1" class="blob-num js-line-number" data-line-number="1"></td>
        <td id="LC1" class="blob-code blob-code-inner">export function add(a, b) {</td>
      </tr>
      <tr>
        <td id="L2" class="blob-num js-line-number" data-line-number="2"></td>
        <td id="LC2" class="blob-code blob-code-inner">  return a + b;</td>
      </tr>
      <tr>
        <td id="L3" class="blob-num js-line-number" data-line-number="3"></td>
        <td id="LC3" class="blob-code blob-code-inner">}</td>
      </tr>
    </tbody>
  </table>
</div>
`;

/** React-rendered file view, as served by the modern code view. */
export const REACT_BLOB = `
<div data-testid="code-view" data-path="src/calculator.ts">
  <div class="react-code-lines">
    <div class="react-code-line-container">
      <div class="react-line-number" data-line-number="1">1</div>
      <div class="react-code-text">export function add(a, b) {</div>
    </div>
    <div class="react-code-line-container">
      <div class="react-line-number" data-line-number="2">2</div>
      <div class="react-code-text">  return a + b;</div>
    </div>
    <div class="react-code-line-container">
      <div class="react-line-number" data-line-number="3">3</div>
      <div class="react-code-text">}</div>
    </div>
  </div>
</div>
`;

/** A shape none of the specific adapters know, but which still exposes line numbers. */
export const UNKNOWN_FUTURE_MARKUP = `
<main data-path="src/calculator.ts">
  <section class="totally-new-thing">
    <span data-line-number="1">1</span><span class="code">export function add(a, b) {</span>
  </section>
  <section class="totally-new-thing">
    <span data-line-number="2">2</span><span class="code">  return a + b;</span>
  </section>
</main>
`;
