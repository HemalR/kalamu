import { describe, expect, it } from "vitest";
import { assignKeys } from "../src/lib/palette";

describe("assignKeys", () => {
  it("assigns digits 1-9 first, then letters in home-row order", () => {
    expect(assignKeys(12)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "s", "d"]);
  });

  it("continues through the full letter sequence", () => {
    const keys = assignKeys(35);
    expect(keys.slice(9)).toEqual([..."asdfghjkl", ..."qwertyuiop", ..."zxcvbnm"]);
  });

  it("skips reserved keys without consuming a slot", () => {
    // The unblock level reserves `a` for "Remove all blockers".
    expect(assignKeys(11, new Set(["a"]))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "s", "d"]);
  });

  it("skips several reserved keys, digits included", () => {
    expect(assignKeys(3, new Set(["1", "2", "s"]))).toEqual(["3", "4", "5"]);
    expect(assignKeys(11, new Set([..."123456789"]))).toEqual([..."asdfghjkl", "q", "w"]);
  });

  it("returns null past the key supply — those rows stay click-only", () => {
    const keys = assignKeys(40);
    expect(keys).toHaveLength(40);
    expect(keys[34]).toBe("m");
    expect(keys.slice(35)).toEqual([null, null, null, null, null]);
  });

  it("reserving keys shrinks the supply accordingly", () => {
    const keys = assignKeys(35, new Set(["a"]));
    expect(keys[33]).toBe("m");
    expect(keys[34]).toBeNull();
  });

  it("handles an empty list", () => {
    expect(assignKeys(0)).toEqual([]);
  });
});
