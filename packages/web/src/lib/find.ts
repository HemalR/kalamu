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
