import { describe, expect, it } from "vitest";
import { buildTree, isDescendant, pathOf, preorder } from "../src/tree.js";
import { bullet, task } from "./helpers.js";

describe("buildTree / preorder", () => {
  it("lenient parse: interleaved lines still order siblings by relative position", () => {
    // File order: A, B, A1, B1 — siblings A,B keep relative order; children attach correctly.
    const nodes = [
      bullet("n_A", { text: "A" }),
      bullet("n_B", { text: "B" }),
      task("n_A1", { parentId: "n_A", text: "A1" }),
      task("n_B1", { parentId: "n_B", text: "B1" }),
    ];
    const ordered = preorder(buildTree(nodes));
    expect(ordered.map((n) => n.text)).toEqual(["A", "A1", "B", "B1"]);
  });

  it("excludes orphans and cycle members from the tree", () => {
    const nodes = [
      bullet("n_001"),
      bullet("n_orphan", { parentId: "n_ghost" }),
      bullet("n_c1", { parentId: "n_c2" }),
      bullet("n_c2", { parentId: "n_c1" }),
    ];
    const ordered = preorder(buildTree(nodes));
    expect(ordered.map((n) => n.id)).toEqual(["n_001"]);
  });

  it("computes paths and descendant checks", () => {
    const nodes = [
      bullet("n_001", { text: "root" }),
      bullet("n_002", { parentId: "n_001", text: "mid" }),
      task("n_003", { parentId: "n_002", text: "leaf" }),
    ];
    const tree = buildTree(nodes);
    const leaf = tree.byId.get("n_003");
    expect(leaf && pathOf(tree, leaf)).toEqual(["root", "mid"]);
    expect(isDescendant(tree, "n_003", "n_001")).toBe(true);
    expect(isDescendant(tree, "n_001", "n_003")).toBe(false);
  });
});
