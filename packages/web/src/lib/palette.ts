/**
 * Pure key logic for the leader-key command palette (no Svelte imports,
 * unit-tested). Dynamic submenus (labels, block candidates, blockers, CLI
 * commands) get their trigger keys auto-assigned from a fixed sequence;
 * fixed levels (root, priority, assign, view) carry hand-picked keys.
 */

/** `1`-`9`, then letters in home-row order (SPEC "Command palette"). */
const KEY_SEQUENCE = [..."123456789", ..."asdfghjkl", ..."qwertyuiop", ..."zxcvbnm"];

/**
 * Trigger keys for `count` list items, in order: digits first, then letters,
 * skipping any key the level reserves for a fixed row (the unblock level
 * reserves `a` for "Remove all blockers"). Items past the key supply get
 * null — rendered without a badge, reachable only by click/scroll.
 */
export function assignKeys(count: number, reserved: ReadonlySet<string> = new Set()): (string | null)[] {
  const available = KEY_SEQUENCE.filter((key) => !reserved.has(key));
  return Array.from({ length: count }, (_, index) => available[index] ?? null);
}
