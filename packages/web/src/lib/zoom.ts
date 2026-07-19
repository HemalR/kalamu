/**
 * Zoom hash codec: the URL hash ("#z=<id>") is zoom's only persistence —
 * session view state, never written to ui-state.json (that file is shared
 * across tabs/agents). Ids in the hash are SERVER ids, so links survive
 * reloads and paste across sessions. Pure (no Svelte/DOM), for unit tests.
 */

export function formatZoomHash(id: string | null): string {
  return id === null ? "" : `#z=${encodeURIComponent(id)}`;
}

/** Null for anything that isn't a well-formed zoom hash (garbage is ignored). */
export function parseZoomHash(hash: string): string | null {
  const id = /^#?z=(.+)$/.exec(hash)?.[1];
  if (id === undefined) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return null; // malformed percent-encoding
  }
}
