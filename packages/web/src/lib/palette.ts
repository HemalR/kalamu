/**
 * Pure key logic for the leader-key command palette (no Svelte imports,
 * unit-tested). Dynamic submenus (labels, block candidates, blockers, CLI
 * commands) get their trigger keys auto-assigned from a fixed sequence;
 * fixed levels (root, priority, assign, blocking, view, zoom) carry hand-picked
 * keys.
 */

/** `1`-`9`, then letters in home-row order (SPEC "Command palette"). */
const KEY_SEQUENCE = [..."123456789", ..."asdfghjkl", ..."qwertyuiop", ..."zxcvbnm"];

/** Stable leader sequences whose hierarchy is part of the product contract. */
export const LEADER_KEYS = {
  root: { block: "b", redo: "r", undo: "u", zoom: "z" },
  block: { add: "a", remove: "r" },
  zoom: { in: "i", out: "o" },
} as const;

/** Keys held as their `event.key` name print as the glyph they are. */
const KEY_BADGES: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** What a trigger key looks like in its badge. */
export function keyBadge(key: string): string {
  return KEY_BADGES[key] ?? key;
}

/** Digits, then letters, then everything else (arrows, punctuation), then keyless rows. */
function rank(key: string | null): number {
  if (key === null) return 3;
  if (key >= "0" && key <= "9") return 0;
  return /^[a-z]$/i.test(key) ? 1 : 2;
}

/**
 * Reading order for a level whose keys are hand-picked: digits first, then
 * alphabetically. Ranks past the letters (arrow and punctuation rows) keep
 * their declared order — the sort is stable, so those stay grouped as written.
 * Levels with auto-assigned keys are never sorted: there the list order is the
 * meaningful one (open tasks first, and so on) and the keys just follow it.
 */
export function sortByKey<T extends { key: string | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const [left, right] = [rank(a.key), rank(b.key)];
    if (left !== right) return left - right;
    return left <= 1 && a.key !== null && b.key !== null ? a.key.localeCompare(b.key) : 0;
  });
}

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
