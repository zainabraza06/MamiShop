/**
 * The little formatting a shopping assistant reply may carry.
 *
 * The model is asked for plain text but often answers in Markdown anyway:
 * `**bold**` names and `- ` bullet points. Shown as typed, a customer sees the
 * asterisks. This turns the common cases into structure the chat renders as
 * real bold text and lists, and reduces everything else (headings, quotes,
 * links, code) to its plain words.
 *
 * It returns data, not HTML: the widget builds React elements from it, so a
 * reply can never inject markup into the page.
 */

export interface InlinePart {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type ChatBlock =
  | { type: 'paragraph'; parts: InlinePart[] }
  | { type: 'list'; ordered: boolean; items: InlinePart[][] };

const UNORDERED_ITEM = /^\s*[-*•]\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;

/** `**bold**`, `__bold__` and `*italic*`, in the order they appear. */
const EMPHASIS = /(\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\s][^*]*?\*)/g;

function cleanInline(text: string): string {
  return (
    text
      // [label](https://…) → label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      // `code` → code
      .replace(/`([^`]+)`/g, '$1')
  );
}

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const source = cleanInline(text);
  let last = 0;

  for (const match of source.matchAll(EMPHASIS)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ text: source.slice(last, start) });

    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      parts.push({ text: token.slice(2, -2), bold: true });
    } else {
      parts.push({ text: token.slice(1, -1), italic: true });
    }
    last = start + token.length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });

  // A marker left without its partner (a reply cut short) is noise, not text.
  return parts
    .map((part) =>
      part.bold || part.italic ? part : { ...part, text: part.text.replace(/\*\*|__/g, '') },
    )
    .filter((part) => part.text.length > 0);
}

export function parseChatText(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: InlinePart[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', parts: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ...list });
      list = null;
    }
  };

  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Headings and quotes carry no meaning in a chat bubble; keep their words.
    const line = rawLine.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*>\s?/, '');

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    const ordered = unordered ? null : ORDERED_ITEM.exec(line);
    const item = unordered ?? ordered;

    if (item) {
      flushParagraph();
      const isOrdered = ordered !== null;
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push(parseInline(item[1]));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
