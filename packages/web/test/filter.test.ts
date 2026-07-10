import { buildTree, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import { filterVisibleIds } from "../src/lib/filter";

function node(overrides: Partial<KalamuNode> & { id: string }): KalamuNode {
  return {
    parentId: null,
    kind: "bullet",
    text: "",
    createdAt: "2026-07-09T00:00:00.000Z",
    doneAt: null,
    handoff: null,
    ...overrides,
  };
}

// root ─ mid(#backend) ─ leaf        <- match chain
//      └ other ─ otherleaf           <- unrelated subtree
// solo(#backend)                     <- root-level match
// unrelated-root
const tree = buildTree([
  node({ id: "root", text: "umbrella" }),
  node({ id: "mid", parentId: "root", text: "the #backend work" }),
  node({ id: "leaf", parentId: "mid", text: "detail" }),
  node({ id: "other", parentId: "root", text: "frontend" }),
  node({ id: "otherleaf", parentId: "other", text: "css" }),
  node({ id: "solo", text: "#backend infra" }),
  node({ id: "lone", text: "notes" }),
]);

describe("filterVisibleIds", () => {
  it("shows matches with their ancestors and descendants", () => {
    expect([...filterVisibleIds(tree, "backend")].sort()).toEqual(["leaf", "mid", "root", "solo"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterVisibleIds(tree, "nope").size).toBe(0);
  });

  it("handles nested matches without double-counting", () => {
    const nested = buildTree([
      node({ id: "a", text: "#x" }),
      node({ id: "b", parentId: "a", text: "also #x here" }),
      node({ id: "c", parentId: "b", text: "child" }),
    ]);
    expect([...filterVisibleIds(nested, "x")].sort()).toEqual(["a", "b", "c"]);
  });

  it("matches are case-insensitive via derived lowercase names", () => {
    const cased = buildTree([node({ id: "a", text: "ship #Backend now" })]);
    expect(filterVisibleIds(cased, "backend").has("a")).toBe(true);
  });
});
