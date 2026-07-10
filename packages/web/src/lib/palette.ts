/**
 * Pure list logic for the command palette (no Svelte imports, unit-tested):
 * query filtering, disabled-aware selection, and the digits-as-quick-select
 * rule. Disabled items stay visible (the root list is fixed — SPEC) but can
 * never be selected or activated.
 */

export function filterItems<T extends { label: string }>(items: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...items];
  return items.filter((item) => item.label.toLowerCase().includes(needle));
}

/**
 * Where the selection rests: `cursor` clamped into the list, then snapped
 * forward (wrapping) to an enabled item. -1 when nothing is selectable.
 */
export function snapSelection<T extends { disabled?: boolean }>(filtered: readonly T[], cursor: number): number {
  if (filtered.length === 0) return -1;
  const start = Math.min(Math.max(cursor, 0), filtered.length - 1);
  for (let step = 0; step < filtered.length; step++) {
    const index = (start + step) % filtered.length;
    if (!filtered[index]?.disabled) return index;
  }
  return -1;
}

/**
 * ArrowUp/Down: the next enabled index in `delta` direction, wrapping and
 * skipping disabled items; unchanged when nothing else is enabled.
 */
export function stepSelection<T extends { disabled?: boolean }>(
  filtered: readonly T[],
  selected: number,
  delta: -1 | 1,
): number {
  if (selected === -1) return -1;
  const length = filtered.length;
  for (let step = 1; step <= length; step++) {
    const index = (((selected + delta * step) % length) + length) % length;
    if (!filtered[index]?.disabled) return index;
  }
  return selected;
}

/**
 * What a digit keypress means: with an empty query it activates the Nth
 * (1-based) filtered item — unless that item is disabled, in which case the
 * press is swallowed (a disabled number must not leak into the query). Once
 * anything is typed, or the digit points past the list, it is ordinary query
 * text (so tags like "v2" stay typeable).
 */
export type DigitAction<T> = { kind: "activate"; item: T } | { kind: "swallow" } | { kind: "type" };

export function digitPick<T extends { disabled?: boolean }>(
  filtered: readonly T[],
  query: string,
  digit: number,
): DigitAction<T> {
  if (query !== "") return { kind: "type" };
  const item = filtered[digit - 1];
  if (!item) return { kind: "type" };
  return item.disabled ? { kind: "swallow" } : { kind: "activate", item };
}
