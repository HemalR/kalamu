/**
 * The Kalamu app mark, rendered as standalone SVG in a given accent — the one
 * source of truth for the logo geometry, shared by the web favicon (rounded
 * tab tile) and the CLI hub's per-project install icons (full-bleed, maskable-
 * safe). Dependency-free and browser-safe.
 *
 * The mark is a tiny outline: a bullet on the stem (a thought, connected) and a
 * checkbox nested beneath it (a task, indented), which together read as a "k".
 */

/** The bronze brand accent — the default when no project colour applies. */
export const BRAND_BRONZE = "#9a6a2e";

/** sRGB relative luminance (WCAG), 0 (black) … 1 (white); unparseable → 0. */
export function relativeLuminance(hex: string): number {
  const [, hex6] = /^#?([0-9a-f]{6})$/i.exec(hex.trim()) ?? [];
  if (hex6 === undefined) return 0;
  const int = Number.parseInt(hex6, 16);
  const lin = (byte: number): number => {
    const s = byte / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((int >> 16) & 0xff) + 0.7152 * lin((int >> 8) & 0xff) + 0.0722 * lin(int & 0xff);
}

/** Mark colour that reads clearly on `accent` — cream on dark, near-black on light. */
export function markInk(accent: string): string {
  return relativeLuminance(accent) > 0.5 ? "#241803" : "#fbf4e9";
}

/** The fanned-k mark's strokes, in `ink`, drawn within a 0..100 box. */
function markPaths(ink: string): string {
  return (
    `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round">` +
    `<path d="M30 18 L30 84"/><path d="M42 45 L75 28"/><path d="M56 63 L79 77"/></g>` +
    `<circle cx="30" cy="47" r="8" fill="${ink}"/>` +
    `<rect x="39" y="54.5" width="15" height="15" rx="3.5" fill="none" stroke="${ink}" stroke-width="6"/>`
  );
}

/** Rounded favicon/tab tile in `accent` (transparent corners). */
export function faviconTileSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" rx="23" fill="${accent}"/>` +
    `<g transform="translate(50 50) scale(0.8) translate(-50 -50)">${markPaths(markInk(accent))}</g></svg>`
  );
}

/** Full-bleed square app icon in `accent`; the mark stays within the maskable safe zone. */
export function appIconSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${accent}"/>` +
    `<g transform="translate(50 50) scale(0.62) translate(-50 -50)">${markPaths(markInk(accent))}</g></svg>`
  );
}
