import type { PageContext } from '../location.js';
import { legacyBlobAdapter, legacyDiffAdapter } from './legacy.js';
import { reactViewAdapter } from './react.js';
import type { DomAdapter, FileBlock } from './types.js';

export type { CodeLine, DomAdapter, FileBlock } from './types.js';
export { pathFromElement, parseLineNumber } from './types.js';

/**
 * Adapters in priority order. The specific ones come first because they identify file
 * boundaries precisely; the React adapter is last and doubles as the fallback.
 */
export const ADAPTERS: readonly DomAdapter[] = [
  legacyDiffAdapter,
  legacyBlobAdapter,
  reactViewAdapter,
];

export interface CollectResult {
  adapterId: string;
  blocks: FileBlock[];
}

/**
 * Collects annotatable file blocks from the page.
 *
 * On a single-file view the path is taken from the URL when the DOM does not carry it,
 * which is both cheaper and more reliable than scraping the breadcrumb.
 */
export function collectFileBlocks(root: ParentNode, context: PageContext): CollectResult {
  for (const adapter of ADAPTERS) {
    const blocks = adapter.collect(root);
    if (blocks.length === 0) {
      continue;
    }

    const resolved = blocks.map((block) => ({
      ...block,
      path: block.path ?? (context.kind === 'blob' ? (context.path ?? null) : null),
    }));

    if (resolved.some((block) => block.path !== null)) {
      return { adapterId: adapter.id, blocks: resolved };
    }
  }

  return { adapterId: 'none', blocks: [] };
}
