/**
 * Abstraction over GitHub's markup.
 *
 * GitHub has rewritten its file and diff views several times, and the 2018 Codecov
 * extension died patching selectors after every change. Adapters isolate that churn:
 * each one understands a single rendering, they are tried in order, and a
 * selector-agnostic fallback keeps the overlay working when the specific ones stop
 * matching.
 */

export interface CodeLine {
  /** 1-based line number in the current (right-hand) version of the file. */
  number: number;
  /** Element that receives the coverage marker, normally the line-number cell. */
  gutter: HTMLElement;
  /** Row element, tinted when line highlighting is enabled. */
  row: HTMLElement;
}

export interface FileBlock {
  /** Repository-relative path, or `null` when it could not be determined. */
  path: string | null;
  root: HTMLElement;
  lines: CodeLine[];
}

export interface DomAdapter {
  readonly id: string;
  /** Collects the file blocks this adapter understands. Returns `[]` when not applicable. */
  collect(root: ParentNode): FileBlock[];
}

const PATH_ATTRIBUTES = [
  'data-tagsearch-path',
  'data-path',
  'data-file-path',
  'data-file-name',
] as const;

/** Reads a file path from the attributes GitHub has used across its various diff views. */
export function pathFromElement(element: Element | null): string | null {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    for (const attribute of PATH_ATTRIBUTES) {
      const value = node.getAttribute(attribute);
      if (value && value.trim().length > 0) {
        return value.trim();
      }
    }

    const nested = node.querySelector?.('[data-tagsearch-path], [data-path]');
    if (nested) {
      for (const attribute of PATH_ATTRIBUTES) {
        const value = nested.getAttribute(attribute);
        if (value && value.trim().length > 0) {
          return value.trim();
        }
      }
    }
  }

  return null;
}

export function parseLineNumber(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
}
