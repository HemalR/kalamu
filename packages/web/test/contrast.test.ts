/**
 * WCAG contrast of the theme tokens and the tag chips, in both themes. Token
 * values are read from tokens.css itself; the chip recipe (text = tag colour
 * mixed in oklab toward black/white, background = a 15% tint) mirrors
 * TagChip.svelte — change both together.
 */
import { TAG_PALETTE } from "@kalamu/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Rgb = [number, number, number];

const tokens = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");

/** A `--name: light-dark(#light, #dark)` token's two hex values. */
function token(name: string): { light: Rgb; dark: Rgb } {
  const match = new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`).exec(tokens);
  if (match?.[1] === undefined || match[2] === undefined) throw new Error(`no hex light-dark token --${name}`);
  return { light: hex(match[1]), dark: hex(match[2]) };
}

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number): number => Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
const luminance = ([r, g, b]: Rgb): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `color-mix(in srgb, fg <alpha>, transparent)` painted over `bg`. */
const tint = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as Rgb;

function toOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(linear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Rgb): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(gamma) as Rgb;
}

/** `color-mix(in oklab, a <share>, b)`. */
function mixOklab(a: Rgb, share: number, b: Rgb): Rgb {
  const [x, y] = [toOklab(a), toOklab(b)];
  return fromOklab(x.map((v, i) => v * share + y[i]! * (1 - share)) as Rgb);
}

const bg = token("bg");
const panel = token("panel");
const themes = [
  { name: "light", ink: (tag: Rgb) => mixOklab(tag, 0.6, [0, 0, 0]), grounds: [bg.light, panel.light] },
  { name: "dark", ink: (tag: Rgb) => mixOklab(tag, 0.65, [1, 1, 1]), grounds: [bg.dark, panel.dark] },
] as const;

describe("contrast (WCAG AA)", () => {
  it.each(themes)("tag chips are ≥4.5:1 in $name", ({ ink, grounds }) => {
    for (const color of TAG_PALETTE) {
      for (const ground of grounds) {
        expect(contrast(ink(hex(color)), tint(hex(color), 0.15, ground)), color).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("muted text is ≥4.5:1 and checkbox outlines ≥3:1 on both grounds", () => {
    const [muted, check] = [token("muted"), token("check-border")];
    for (const theme of ["light", "dark"] as const) {
      for (const ground of [bg[theme], panel[theme]]) {
        expect(contrast(muted[theme], ground)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(check[theme], ground)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
