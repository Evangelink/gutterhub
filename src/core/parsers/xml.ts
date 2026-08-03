/**
 * Minimal, dependency-free XML tag scanner.
 *
 * Coverage reports are consumed from a MV3 background service worker where `DOMParser`
 * is unavailable, and from Node during tests where it is equally absent without a
 * heavyweight polyfill. Only the small subset needed by Cobertura is implemented:
 * element open/close events, attributes, and character data.
 */

export interface XmlTag {
  name: string;
  attributes: Record<string, string>;
  selfClosing: boolean;
}

export interface XmlHandlers {
  onOpen?(tag: XmlTag): void;
  onClose?(name: string): void;
  /** Character data, already entity-decoded. Only emitted for non-blank runs. */
  onText?(text: string, parent: string | undefined): void;
}

const TAG_PATTERN = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g;
const ATTRIBUTE_PATTERN = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const CDATA_PATTERN = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) {
    return value;
  }

  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITIES[entity] ?? match;
  });
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(raw)) !== null) {
    const name = match[1]!;
    const value = match[2] ?? match[3] ?? '';
    attributes[name] = decodeXmlEntities(value);
  }

  return attributes;
}

export function scanXml(input: string, handlers: XmlHandlers): void {
  // Comments and CDATA can contain angle brackets that would otherwise be mistaken
  // for markup, so neutralise them before scanning.
  const text = input
    .replace(COMMENT_PATTERN, '')
    .replace(CDATA_PATTERN, (_, content: string) =>
      String(content).replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    );

  const stack: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  TAG_PATTERN.lastIndex = 0;

  while ((match = TAG_PATTERN.exec(text)) !== null) {
    if (handlers.onText && match.index > cursor) {
      const chunk = text.slice(cursor, match.index);
      if (chunk.trim().length > 0) {
        handlers.onText(decodeXmlEntities(chunk.trim()), stack[stack.length - 1]);
      }
    }
    cursor = TAG_PATTERN.lastIndex;

    const isClosing = match[1] === '/';
    const name = match[2]!;
    const rawAttributes = match[3] ?? '';

    if (isClosing) {
      // Tolerate unbalanced documents: unwind to the matching element if present,
      // otherwise ignore the stray close tag rather than corrupting the stack.
      const depth = stack.lastIndexOf(name);
      if (depth !== -1) {
        stack.length = depth;
      }
      handlers.onClose?.(name);
      continue;
    }

    const selfClosing = rawAttributes.trimEnd().endsWith('/');
    handlers.onOpen?.({
      name,
      attributes: parseAttributes(rawAttributes),
      selfClosing,
    });

    if (selfClosing) {
      handlers.onClose?.(name);
    } else {
      stack.push(name);
    }
  }
}
