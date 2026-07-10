import { describe, expect, it } from "vitest";
import { TAG_PALETTE, tagColor } from "../src/tags.js";

describe("tagColor", () => {
  it("is deterministic and always from the palette", () => {
    expect(tagColor("backend")).toBe(tagColor("backend"));
    expect(TAG_PALETTE).toContain(tagColor("backend"));
    expect(TAG_PALETTE).toContain(tagColor("a"));
  });

  it("overrides win", () => {
    expect(tagColor("backend", { backend: "#123456" })).toBe("#123456");
    expect(TAG_PALETTE).toContain(tagColor("other", { backend: "#123456" }));
  });

  it("spreads distinct names across slots", () => {
    const names = ["backend", "frontend", "perf", "research", "publishing", "bug", "idea", "infra"];
    const distinct = new Set(names.map((n) => tagColor(n)));
    expect(distinct.size).toBeGreaterThan(3);
  });
});
