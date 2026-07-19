/**
 * Numbered-list continuation: a node whose text starts with an `N.` prefix
 * (digits, dot, whitespace — so "3.14 pie" doesn't count) seeds its
 * Enter-created sibling with the next number.
 */

/** `"{N+1}. "` (canonical single-space form) when `text` starts with `N.` + whitespace, else `""`. */
export function nextNumberPrefix(text: string): string {
  const match = /^(\d+)\.\s/.exec(text);
  return match === null ? "" : `${Number(match[1]) + 1}. `;
}
