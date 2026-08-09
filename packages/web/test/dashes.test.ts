import { describe, expect, it } from "vitest";
import { dashCounts, MAX_DASHES } from "../src/lib/dashes";

/** Every result must fill exactly one strip's worth of dashes. */
function width(done: number, active: number, total: number): number {
  const counts = dashCounts(done, active, total);
  return counts.done + counts.active + counts.rest;
}

describe("dashCounts", () => {
  it("draws one dash per unit up to the cap", () => {
    expect(dashCounts(3, 1, 7)).toEqual({ done: 3, active: 1, rest: 3 });
    expect(dashCounts(0, 0, 1)).toEqual({ done: 0, active: 0, rest: 1 });
    expect(dashCounts(20, 0, 20)).toEqual({ done: 20, active: 0, rest: 0 });
  });

  it("renders nothing for an empty subtree", () => {
    expect(dashCounts(0, 0, 0)).toEqual({ done: 0, active: 0, rest: 0 });
  });

  it("buckets to exactly the cap above it", () => {
    expect(width(50, 10, 100)).toBe(MAX_DASHES);
    expect(width(0, 0, 21)).toBe(MAX_DASHES);
    expect(width(1, 1, 999)).toBe(MAX_DASHES);
    expect(dashCounts(50, 10, 100)).toEqual({ done: 10, active: 2, rest: 8 });
  });

  it("never rounds a non-zero slice away to nothing", () => {
    const counts = dashCounts(1, 1, 999);
    expect(counts.done).toBeGreaterThan(0);
    expect(counts.active).toBeGreaterThan(0);
    expect(counts.rest).toBeGreaterThan(0);
  });

  it("leaves no unfilled dash once everything is done", () => {
    expect(dashCounts(100, 0, 100)).toEqual({ done: 20, active: 0, rest: 0 });
    expect(dashCounts(90, 10, 100)).toEqual({ done: 18, active: 2, rest: 0 });
  });

  it("holds the invariants across a sweep of counts", () => {
    for (let total = 1; total <= 120; total++) {
      for (const done of [0, 1, Math.floor(total / 3), total - 1, total]) {
        if (done < 0 || done > total) continue;
        const active = Math.min(total - done, 2);
        const counts = dashCounts(done, active, total);
        expect(counts.done + counts.active + counts.rest).toBe(Math.min(total, MAX_DASHES));
        for (const [units, dashes] of [
          [done, counts.done],
          [active, counts.active],
          [total - done - active, counts.rest],
        ] as const) {
          expect(dashes).toBeGreaterThanOrEqual(0);
          if (units > 0) expect(dashes).toBeGreaterThan(0);
          if (units === 0) expect(dashes).toBe(0);
        }
      }
    }
  });
});
