import { describe, expect, it } from "vitest";
import { digitPick, filterItems, snapSelection, stepSelection } from "../src/lib/palette";

const items = [{ label: "Priority" }, { label: "Labels" }, { label: "Assign" }, { label: "#v2" }];

// The fixed root list with no node focused: items 1-7 disabled, the rest enabled.
const noFocusRoot = [
  { label: "Priority…", disabled: true },
  { label: "Labels…", disabled: true },
  { label: "Assign…", disabled: true },
  { label: "Toggle done", disabled: true },
  { label: "Collapse parent", disabled: true },
  { label: "Expand children", disabled: true },
  { label: "Copy CLI command…", disabled: true },
  { label: "Activate dark mode" },
  { label: "Clean up" },
  { label: "View keyboard shortcuts" },
  { label: "View CLI commands" },
];

describe("filterItems", () => {
  it("returns every item for an empty query", () => {
    expect(filterItems(items, "")).toEqual(items);
    expect(filterItems(items, "   ")).toEqual(items);
  });

  it("matches case-insensitive substrings of the label", () => {
    expect(filterItems(items, "LAB")).toEqual([{ label: "Labels" }]);
    expect(filterItems(items, "Ri")).toEqual([{ label: "Priority" }]);
    expect(filterItems(items, "i")).toEqual([{ label: "Priority" }, { label: "Assign" }]);
  });

  it("keeps disabled items listed — they grey out, never vanish", () => {
    expect(filterItems(noFocusRoot, "prio")).toEqual([{ label: "Priority…", disabled: true }]);
  });

  it("returns nothing when no label matches", () => {
    expect(filterItems(items, "zzz")).toEqual([]);
  });

  it("also matches the hidden search text, so a shortened label still finds its node", () => {
    const rows = [{ label: "Ship the API", search: "Ship the API: the token endpoint must land first" }];
    expect(filterItems(rows, "token")).toEqual(rows);
    expect(filterItems(rows, "nothing here")).toEqual([]);
  });
});

describe("snapSelection", () => {
  it("clamps the cursor into the list", () => {
    expect(snapSelection(items, 0)).toBe(0);
    expect(snapSelection(items, 99)).toBe(3);
  });

  it("snaps forward past disabled items, wrapping", () => {
    expect(snapSelection(noFocusRoot, 0)).toBe(7);
    expect(snapSelection(noFocusRoot, 8)).toBe(8);
  });

  it("returns -1 when nothing is selectable", () => {
    expect(snapSelection([], 0)).toBe(-1);
    expect(snapSelection([{ disabled: true }, { disabled: true }], 0)).toBe(-1);
  });
});

describe("stepSelection", () => {
  it("moves by one among enabled items, wrapping", () => {
    expect(stepSelection(items, 0, 1)).toBe(1);
    expect(stepSelection(items, 0, -1)).toBe(3);
    expect(stepSelection(items, 3, 1)).toBe(0);
  });

  it("skips disabled items in both directions", () => {
    expect(stepSelection(noFocusRoot, 7, 1)).toBe(8);
    expect(stepSelection(noFocusRoot, 10, 1)).toBe(7); // wraps past 0-6
    expect(stepSelection(noFocusRoot, 7, -1)).toBe(10); // wraps backwards past 6-0
  });

  it("stays put when nothing else is enabled", () => {
    expect(stepSelection([{ label: "only" }], 0, 1)).toBe(0);
    expect(stepSelection([], -1, 1)).toBe(-1);
  });
});

describe("digitPick", () => {
  it("activates the Nth (1-based) filtered item when the query is empty", () => {
    expect(digitPick(items, "", 1)).toEqual({ kind: "activate", item: { label: "Priority" } });
    expect(digitPick(items, "", 3)).toEqual({ kind: "activate", item: { label: "Assign" } });
  });

  it("swallows digits that point at disabled items", () => {
    expect(digitPick(noFocusRoot, "", 1)).toEqual({ kind: "swallow" });
    expect(digitPick(noFocusRoot, "", 7)).toEqual({ kind: "swallow" });
    expect(digitPick(noFocusRoot, "", 8)).toEqual({ kind: "activate", item: { label: "Activate dark mode" } });
  });

  it("treats digits as query text once anything is typed", () => {
    expect(digitPick(items, "v", 2)).toEqual({ kind: "type" });
  });

  it("treats digits beyond the filtered list as query text", () => {
    expect(digitPick(items, "", 5)).toEqual({ kind: "type" });
    expect(digitPick([], "", 1)).toEqual({ kind: "type" });
  });
});
