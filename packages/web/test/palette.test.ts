import { describe, expect, it } from "vitest";
import { nodeCommands } from "../src/lib/cli-commands";
import { digitPick, filterItems, snapSelection, stepSelection } from "../src/lib/palette";

const items = [{ label: "Priority" }, { label: "Labels" }, { label: "Toggle mine" }, { label: "#v2" }];

// The fixed root list with no node focused: items 1-5 disabled, view items enabled.
const noFocusRoot = [
  { label: "Priority…", disabled: true },
  { label: "Labels…", disabled: true },
  { label: "Toggle mine", disabled: true },
  { label: "Toggle done", disabled: true },
  { label: "Copy CLI command…", disabled: true },
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
    expect(filterItems(items, "i")).toEqual([{ label: "Priority" }, { label: "Toggle mine" }]);
  });

  it("keeps disabled items listed — they grey out, never vanish", () => {
    expect(filterItems(noFocusRoot, "prio")).toEqual([{ label: "Priority…", disabled: true }]);
  });

  it("returns nothing when no label matches", () => {
    expect(filterItems(items, "zzz")).toEqual([]);
  });
});

describe("snapSelection", () => {
  it("clamps the cursor into the list", () => {
    expect(snapSelection(items, 0)).toBe(0);
    expect(snapSelection(items, 99)).toBe(3);
  });

  it("snaps forward past disabled items, wrapping", () => {
    expect(snapSelection(noFocusRoot, 0)).toBe(5);
    expect(snapSelection(noFocusRoot, 6)).toBe(6);
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
    expect(stepSelection(noFocusRoot, 5, 1)).toBe(6);
    expect(stepSelection(noFocusRoot, 6, 1)).toBe(5); // wraps past 0-4
    expect(stepSelection(noFocusRoot, 5, -1)).toBe(6); // wraps backwards past 4-0
  });

  it("stays put when nothing else is enabled", () => {
    expect(stepSelection([{ label: "only" }], 0, 1)).toBe(0);
    expect(stepSelection([], -1, 1)).toBe(-1);
  });
});

describe("digitPick", () => {
  it("activates the Nth (1-based) filtered item when the query is empty", () => {
    expect(digitPick(items, "", 1)).toEqual({ kind: "activate", item: { label: "Priority" } });
    expect(digitPick(items, "", 3)).toEqual({ kind: "activate", item: { label: "Toggle mine" } });
  });

  it("swallows digits that point at disabled items", () => {
    expect(digitPick(noFocusRoot, "", 1)).toEqual({ kind: "swallow" });
    expect(digitPick(noFocusRoot, "", 5)).toEqual({ kind: "swallow" });
    expect(digitPick(noFocusRoot, "", 6)).toEqual({ kind: "activate", item: { label: "View keyboard shortcuts" } });
  });

  it("treats digits as query text once anything is typed", () => {
    expect(digitPick(items, "v", 2)).toEqual({ kind: "type" });
  });

  it("treats digits beyond the filtered list as query text", () => {
    expect(digitPick(items, "", 5)).toEqual({ kind: "type" });
    expect(digitPick([], "", 1)).toEqual({ kind: "type" });
  });
});

describe("nodeCommands", () => {
  it("offers done (not reopen) on an open leaf task", () => {
    expect(nodeCommands({ serverId: "n_1", kind: "task", done: false, hasChildren: false })).toEqual([
      'kalamu show n_1 --children',
      'kalamu done n_1',
      'kalamu handoff n_1 --target backlog --ref ""',
      'kalamu add --parent n_1 --kind task --text ""',
      'kalamu delete n_1',
    ]);
  });

  it("offers reopen on a done task", () => {
    const commands = nodeCommands({ serverId: "n_2", kind: "task", done: true, hasChildren: false });
    expect(commands).toContain("kalamu reopen n_2");
    expect(commands.some((command) => command.startsWith("kalamu done"))).toBe(false);
  });

  it("omits task-only commands on a bullet", () => {
    expect(nodeCommands({ serverId: "n_3", kind: "bullet", done: false, hasChildren: false })).toEqual([
      'kalamu show n_3 --children',
      'kalamu add --parent n_3 --kind task --text ""',
      'kalamu delete n_3',
    ]);
  });

  it("deletes recursively when the node has children", () => {
    const commands = nodeCommands({ serverId: "n_4", kind: "bullet", done: false, hasChildren: true });
    expect(commands).toContain("kalamu delete n_4 --recursive");
  });
});
