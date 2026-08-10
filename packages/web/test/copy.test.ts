import { buildTree, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import { rawNodeText, serializeNodeContext } from "../src/lib/copy";

function node(overrides: Partial<KalamuNode> & { id: string }): KalamuNode {
  return {
    parentId: null,
    kind: "bullet",
    text: "",
    createdAt: "2026-07-09T00:00:00.000Z",
    doneAt: null,
    ...overrides,
  };
}

const tree = buildTree([
  node({ id: "n_1", text: "Auth improvements #auth" }),
  node({ id: "n_2", parentId: "n_1", kind: "task", text: "Fix redirect", priority: 1 }),
  node({ id: "n_3", parentId: "n_2", kind: "task", text: "Write tests", doneAt: "2026-07-09T01:00:00.000Z" }),
]);

describe("serializeNodeContext", () => {
  it.each([
    ["bullet", "Bullet"],
    ["task", "Task"],
    ["discussion", "Discussion"],
  ] as const)("labels a %s with its stable server id", (kind, label) => {
    const kindTree = buildTree([node({ id: "local_1", kind, text: "Selected" })]);
    expect(serializeNodeContext(kindTree, "local_1", "n_server").text).toBe(
      [
        "---",
        `Kalamu ${label} ID: n_server`,
        "",
        kind === "bullet" ? "- Selected" : kind === "task" ? "- [ ] Selected" : "- [?] Selected",
        "---",
      ].join("\n"),
    );
  });

  it("includes only the direct ancestor path and selected subtree", () => {
    const boundaryTree = buildTree([
      node({ id: "root", text: "Project" }),
      node({ id: "root_sibling", text: "Other project" }),
      node({ id: "ancestor_sibling", parentId: "root", text: "Unrelated branch" }),
      node({ id: "parent", parentId: "root", kind: "discussion", text: "Approach" }),
      node({ id: "selected_sibling", parentId: "parent", text: "Alternative" }),
      node({ id: "selected", parentId: "parent", kind: "task", text: "Implement", priority: 1 }),
      node({ id: "child", parentId: "selected", text: "First part" }),
      node({ id: "grandchild", parentId: "child", kind: "task", text: "Verify" }),
    ]);

    expect(serializeNodeContext(boundaryTree, "selected", "n_selected")).toEqual({
      text: [
        "---",
        "Kalamu Task ID: n_selected",
        "",
        "- Project",
        "  - [?] Approach",
        "    - [ ] p1 Implement",
        "      - First part",
        "        - [ ] Verify",
        "---",
      ].join("\n"),
      count: 5,
    });
  });

  it("returns empty for an unknown id", () => {
    expect(serializeNodeContext(tree, "n_missing", "n_missing")).toEqual({ text: "", count: 0 });
  });
});

describe("rawNodeText", () => {
  it.each(["bullet", "task", "discussion"] as const)("copies only a %s's text", (kind) => {
    const kindTree = buildTree([node({ id: "n_selected", kind, text: "Raw #text" })]);
    expect(rawNodeText(kindTree, "n_selected")).toBe("Raw #text");
  });

  it("prefers the current editor draft verbatim and returns null for an unknown id", () => {
    expect(rawNodeText(tree, "n_2", "Draft p1 @human")).toBe("Draft p1 @human");
    expect(rawNodeText(tree, "n_missing")).toBeNull();
  });
});
