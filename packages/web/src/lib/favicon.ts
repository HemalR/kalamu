/**
 * Runtime favicon: the fanned-k tab tile in a given accent. In the hub the
 * accent tracks the active project's colour; standalone it stays the bronze
 * brand. Geometry + knockout live in @kalamu/core (shared with the CLI).
 */
import { BRAND_BRONZE, faviconTileSvg } from "@kalamu/core";

export { BRAND_BRONZE };

/** The tab tile in `accent` as an SVG data URI. */
export function faviconDataUri(accent: string): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconTileSvg(accent))}`;
}

/** Point the document's <link rel="icon"> at the tile in `accent`. */
export function setFavicon(accent: string): void {
  if (typeof document === "undefined") return;
  const link = document.querySelector('link[rel="icon"]');
  if (link instanceof HTMLLinkElement) link.href = faviconDataUri(accent);
}
