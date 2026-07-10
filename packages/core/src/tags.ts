/**
 * Deterministic tag colours: the same tag name hashes to the same palette
 * slot on every machine, forever, with no stored state (SPEC key decision 7).
 * meta.json overrides win when present.
 */

export const TAG_PALETTE: readonly string[] = [
  "#e5484d", // red
  "#f76b15", // orange
  "#ffc53d", // amber
  "#46a758", // green
  "#12a594", // teal
  "#00a2c7", // cyan
  "#0090ff", // blue
  "#3e63dd", // indigo
  "#8e4ec6", // purple
  "#d6409f", // pink
  "#978365", // bronze
  "#8d8d8d", // gray
];

/** FNV-1a: stable, dependency-free, good spread for short strings. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function tagColor(tag: string, overrides?: Record<string, string>): string {
  const override = overrides?.[tag];
  if (override) return override;
  const color = TAG_PALETTE[fnv1a(tag) % TAG_PALETTE.length];
  return color ?? "#8d8d8d";
}
