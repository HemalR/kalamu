/**
 * Live colouring of raw #tag tokens in the focused editable via the CSS
 * Custom Highlight API. Highlights style character ranges without inserting
 * elements, so they cannot fight contenteditable="plaintext-only" or the
 * textContent binding.
 *
 * One named highlight per DISTINCT COLOUR (palette or meta.json override),
 * registered lazily with a rule in a constructed stylesheet — overrides
 * therefore get their exact colour with no special-casing. Unsupported
 * browsers degrade to uncoloured (never broken) text.
 */
import { tagColor } from "@kalamu/core";
import { tagSpans } from "./segments";

const supported = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

const byColor = new Map<string, Highlight>();
let sheet: CSSStyleSheet | null = null;
let counter = 0;

function highlightFor(color: string): Highlight {
  let highlight = byColor.get(color);
  if (!highlight) {
    highlight = new Highlight();
    const name = `kalamu-tag-${counter++}`;
    CSS.highlights.set(name, highlight);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    // Colour only — the token should read as a chip in waiting.
    sheet.insertRule(`::highlight(${name}) { color: ${color}; }`);
    byColor.set(color, highlight);
  }
  return highlight;
}

/** Map a character span of `el`'s text content onto a DOM Range. */
function rangeAt(el: HTMLElement, start: number, end: number): Range | null {
  const range = document.createRange();
  let offset = 0;
  let haveStart = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const nodeEnd = offset + text.length;
    if (!haveStart && start <= nodeEnd) {
      range.setStart(text, start - offset);
      haveStart = true;
    }
    if (haveStart && end <= nodeEnd) {
      range.setEnd(text, end - offset);
      return range;
    }
    offset = nodeEnd;
  }
  return null;
}

/**
 * Recolour the tag tokens in the (single, focused) editable. Only one node
 * edits at a time, so clearing every registered highlight first is safe.
 */
export function updateTagHighlights(el: HTMLElement, overrides?: Record<string, string>): void {
  if (!supported) return;
  clearTagHighlights();
  const text = el.textContent ?? "";
  for (const span of tagSpans(text)) {
    const range = rangeAt(el, span.start, span.end);
    if (range) highlightFor(tagColor(span.name, overrides)).add(range);
  }
}

export function clearTagHighlights(): void {
  if (!supported) return;
  for (const highlight of byColor.values()) highlight.clear();
}
