import { describe, expect, it } from "vitest";
import { assignKeys, keyBadge, sortByKey } from "../src/lib/palette";

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

describe("sortByKey", () => {
  const keys = (items: { key: string | null }[]): (string | null)[] => sortByKey(items).map((item) => item.key);

  it("puts digits first, then letters alphabetically", () => {
    expect(keys([{ key: "z" }, { key: "2" }, { key: "a" }, { key: "1" }])).toEqual(["1", "2", "a", "z"]);
  });

  it("sorts letters case-insensitively, as a reader would", () => {
    expect(keys([{ key: "b" }, { key: "A" }])).toEqual(["A", "b"]);
  });

  it("keeps arrows and punctuation after the letters, in declared order", () => {
    expect(keys([{ key: "," }, { key: "ArrowUp" }, { key: "." }, { key: "z" }, { key: "1" }])).toEqual([
      "1",
      "z",
      ",",
      "ArrowUp",
      ".",
    ]);
  });

  it("sinks keyless rows to the end", () => {
    expect(keys([{ key: null }, { key: "." }, { key: "a" }])).toEqual(["a", ".", null]);
  });

  it("does not mutate its input", () => {
    const items = [{ key: "b" }, { key: "a" }];
    sortByKey(items);
    expect(items.map((item) => item.key)).toEqual(["b", "a"]);
  });
});

describe("keyBadge", () => {
  it("prints arrow keys as arrows", () => {
    expect([keyBadge("ArrowUp"), keyBadge("ArrowLeft"), keyBadge("ArrowRight")]).toEqual(["↑", "←", "→"]);
  });

  it("leaves every other key as typed", () => {
    expect([keyBadge("a"), keyBadge("1"), keyBadge(".")]).toEqual(["a", "1", "."]);
  });
});
