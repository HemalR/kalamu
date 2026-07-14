/**
 * Runtime favicon: the fanned-k app tile in a given accent. In the hub the
 * accent tracks the active project's colour; standalone it stays the bronze
 * brand. The knockout flips (cream on dark accents, near-black on light ones)
 * so the mark stays legible across the whole project palette.
 */

/** The bronze brand accent — the default when no project colour applies. */
export const BRAND_BRONZE = "#9a6a2e";

/** sRGB relative luminance (WCAG), 0 (black) … 1 (white). */
function relativeLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) return 0;
  const int = Number.parseInt(match[1], 16);
  const lin = (byte: number): number => {
    const s = byte / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = lin((int >> 16) & 0xff);
  const g = lin((int >> 8) & 0xff);
  const b = lin(int & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Knockout colour that reads clearly on the given tile accent. */
function knockoutFor(accent: string): string {
  return relativeLuminance(accent) > 0.5 ? "#241803" : "#fbf4e9";
}

/** The app-tile favicon (mark knocked out of the accent) as an SVG data URI. */
export function faviconDataUri(accent: string): string {
  const ink = knockoutFor(accent);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
    `<rect width='100' height='100' rx='23' fill='${accent}'/>` +
    `<g fill='none' stroke='${ink}' stroke-width='5.6' stroke-linecap='round'>` +
    `<path d='M34 24.4 L34 77.2'/><path d='M43.6 46 L70 32.4'/><path d='M54.8 60.4 L73.2 71.6'/></g>` +
    `<circle cx='34' cy='47.6' r='6.4' fill='${ink}'/>` +
    `<rect x='41.2' y='53.6' width='12' height='12' rx='2.8' fill='none' stroke='${ink}' stroke-width='4.8'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Point the document's <link rel="icon"> at the tile in `accent`. */
export function setFavicon(accent: string): void {
  if (typeof document === "undefined") return;
  const link = document.querySelector('link[rel="icon"]');
  if (link instanceof HTMLLinkElement) link.href = faviconDataUri(accent);
}
