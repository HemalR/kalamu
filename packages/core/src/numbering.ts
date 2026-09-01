/**
 * Numbered lists. A node is numbered when its text starts with an `N.`
 * prefix — digits, dot, then whitespace or end of text, so "3.14 pie" is
 * prose. The prefix lives in `text` (the CLI, agents and the file all see
 * it), but its VALUE is never authored: every operation ends with a
 * {@link renumber} pass that rewrites each prefix from sibling position, so
 * inserting, deleting or moving inside a list keeps it 1..n without anyone
 * counting. Consecutive numbered siblings form one list; an unnumbered
 * sibling ends it and the next numbered sibling starts again at 1.
 */
import type { KalamuNode } from "./model.js";

const NUMBER_PREFIX = /^(\d+)\.(?:\s+|$)/;

/** The ordinal and the text after the prefix, or null for unnumbered text. */
export function parseNumbering(text: string): { ordinal: number; body: string } | null {
  const match = NUMBER_PREFIX.exec(text);
  return match === null ? null : { ordinal: Number(match[1]), body: text.slice(match[0].length) };
}

/** Text without its `N.` prefix (unchanged when there is none). */
export function stripNumbering(text: string): string {
  return text.replace(NUMBER_PREFIX, "");
}

/** Canonical numbered text: `N. body`, or bare `N.` for an empty body. Replaces any prefix already there. */
export function withNumbering(text: string, ordinal: number): string {
  return format(stripNumbering(text), ordinal);
}

function format(body: string, ordinal: number): string {
  return body === "" ? `${ordinal}.` : `${ordinal}. ${body}`;
}

/**
 * Rewrite every `N.` prefix from sibling position. Expects canonical
 * pre-order (siblings in document order); nodes whose text is already right
 * keep their object identity, so their serialized lines stay byte-identical.
 */
export function renumber(nodes: readonly KalamuNode[]): KalamuNode[] {
  const counters = new Map<string | null, number>();
  return nodes.map((node) => {
    const parsed = parseNumbering(node.text);
    if (parsed === null) {
      counters.set(node.parentId, 0);
      return node;
    }
    const ordinal = (counters.get(node.parentId) ?? 0) + 1;
    counters.set(node.parentId, ordinal);
    const text = format(parsed.body, ordinal);
    return text === node.text ? node : { ...node, text };
  });
}
