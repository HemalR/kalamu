import { buildTree, serializeMarkdown, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import { serializeSubtree } from "../src/lib/copy";

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

// Exhaustive format cases live in core's markdown.test.ts — copy-subtree is
// a thin wrapper over core's serializeMarkdown, verified here as such.
const tree = buildTree([
  node({ id: "n_1", text: "Auth improvements #auth" }),
  node({ id: "n_2", parentId: "n_1", kind: "task", text: "Fix redirect", priority: 1 }),
  node({ id: "n_3", parentId: "n_2", kind: "task", text: "Write tests", doneAt: "2026-07-09T01:00:00.000Z" }),
]);

describe("serializeSubtree", () => {
  it("returns exactly core's markdown for the subtree, with the item count", () => {
    const root = tree.byId.get("n_1");
    if (!root) throw new Error("fixture broken");
    expect(serializeSubtree(tree, "n_1")).toEqual({
      text: serializeMarkdown(tree, [root]),
      count: 3,
    });
    expect(serializeSubtree(tree, "n_1").text).toBe(
      ["- Auth improvements #auth", "  - [ ] p1 Fix redirect", "    - [x] Write tests"].join("\n"),
    );
  });

  it("counts a leaf as one item", () => {
    expect(serializeSubtree(tree, "n_3").count).toBe(1);
  });

  it("returns empty for an unknown id", () => {
    expect(serializeSubtree(tree, "n_missing")).toEqual({ text: "", count: 0 });
  });
});
