/**
 * Find-panel query parsing. An id jump is a whole-query classification, not a
 * substring hunt: mixed prose stays a text search even if it happens to
 * mention an id, because the node's own text is what the human would search.
 */
import { isNodeIdToken } from "@kalamu/core";

export type FindIntent = { kind: "empty" } | { kind: "id"; token: string } | { kind: "text"; needle: string };

/** Strip one layer of quotes, backticks, or brackets a paste often arrives in. */
function unwrap(value: string): string {
  const matched = /^[(`'"<\[](.+)[)`'">\]]$/.exec(value);
  return matched?.[1] === undefined ? value : matched[1].trim();
}

/**
 * Classify a find-box query. A kalamu link (`#z=<id>`, including inside a
 * URL or markdown) is an id; so is a bare / wrapped token of the `n_…` shape.
 * Anything else — including "Fix login (n_001)" — is text.
 */
export function parseFindIntent(raw: string): FindIntent {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };

  const embedded = /#z=(n_[0-9A-Za-z]+)/.exec(trimmed);
  if (embedded?.[1] !== undefined) {
    try {
      const token = decodeURIComponent(embedded[1]);
      if (token !== "") return { kind: "id", token };
    } catch {
      // Malformed percent-encoding — fall through to text.
    }
  }

  const token = unwrap(trimmed);
  if (isNodeIdToken(token)) return { kind: "id", token };
  return { kind: "text", needle: trimmed };
}

/**
 * Map an id token onto a node that exists in `ids`. `alias` is the store's
 * server→local remap so a pasted CLI id still hits an optimistic local node.
 * Lookup is case-insensitive: generated ids are Crockford-uppercase, pastes
 * are not always.
 */
export function resolveNodeId(
  token: string,
  ids: ReadonlyMap<string, unknown> | ReadonlySet<string>,
  alias: (id: string) => string = (id) => id,
): string | null {
  const mapped = alias(token);
  if (ids.has(mapped)) return mapped;
  const lower = token.toLowerCase();
  for (const id of ids instanceof Map ? ids.keys() : ids) {
    if (id.toLowerCase() === lower) return id;
  }
  return null;
}

/** A Find hit's one-line text with the match split out, for highlighting. */
export interface Excerpt {
  before: string;
  match: string;
  after: string;
}

/**
 * The text around the first case-insensitive occurrence of `needle` (core's
 * searchNodes matches the same way): at most `lead` characters before it —
 * cut at a word where one is in reach, marked with "…" — then the match, then
 * the rest, which the row's CSS ellipsis trims. So the match is always in
 * view, however deep into a long node it sits. Null when there is no match.
 */
export function matchExcerpt(text: string, needle: string, lead = 24): Excerpt | null {
  const at = needle === "" ? -1 : text.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return null;
  let start = Math.max(0, at - lead);
  const space = text.indexOf(" ", start);
  if (start > 0 && space !== -1 && space < at) start = space + 1;
  const flat = (part: string): string => part.replace(/\s+/g, " ");
  return {
    before: (start > 0 ? "…" : "") + flat(text.slice(start, at)),
    match: flat(text.slice(at, at + needle.length)),
    after: flat(text.slice(at + needle.length)),
  };
}
