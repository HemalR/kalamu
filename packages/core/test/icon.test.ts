import { describe, expect, it } from "vitest";
import { appIconSvg, BRAND_BRONZE, faviconTileSvg, markInk, relativeLuminance } from "../src/icon.js";

describe("markInk", () => {
  it("uses cream on dark accents and near-black on light ones", () => {
    expect(markInk(BRAND_BRONZE)).toBe("#fbf4e9"); // bronze is dark
    expect(markInk("#0090ff")).toBe("#fbf4e9"); // blue is dark
    expect(markInk("#ffc53d")).toBe("#241803"); // amber is light
  });

  it("treats unparseable input as dark (cream ink)", () => {
    expect(markInk("nonsense")).toBe("#fbf4e9");
  });
});

describe("relativeLuminance", () => {
  it("orders black < mid < white", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#ffc53d")).toBeGreaterThan(0.5);
    expect(relativeLuminance(BRAND_BRONZE)).toBeLessThan(0.5);
  });
});

describe("icon SVG builders", () => {
  it("embed the accent and matching ink, and are valid single-root SVG", () => {
    const svg = appIconSvg("#8e4ec6");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('fill="#8e4ec6"'); // full-bleed accent
    expect(svg).toContain("#fbf4e9"); // cream mark on a dark accent
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
  });

  it("favicon tile is rounded, app icon is full-bleed", () => {
    expect(faviconTileSvg(BRAND_BRONZE)).toContain('rx="23"');
    expect(appIconSvg(BRAND_BRONZE)).not.toContain('rx="23"');
  });
});
