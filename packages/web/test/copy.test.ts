import { buildTree, serializeMarkdown, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import { discussionPrompt, serializeSubtree } from "../src/lib/copy";

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

describe("discussionPrompt", () => {
  const discussionTree = buildTree([
    node({ id: "n_d", kind: "discussion", text: "WorkOS or Auth0 for SSO" }),
    node({ id: "n_d1", parentId: "n_d", text: "Pricing notes" }),
    node({ id: "n_d2", parentId: "n_d1", kind: "task", text: "Spike SAML", priority: 2 }),
    node({ id: "n_leaf", kind: "discussion", text: "Monorepo or polyrepo" }),
  ]);

  it("uses the passed server id throughout — never the tree's local id", () => {
    const prompt = discussionPrompt(discussionTree, "n_d", "n_srv");
    expect(prompt).toBe(
      [
        "Kalamu discussion n_srv: WorkOS or Auth0 for SSO",
        "",
        "  - Pricing notes",
        "    - [ ] p2 Spike SAML",
        "",
        'This is for discussion only — do not make any code changes yet. When we reach a conclusion, help me record the outcome as child bullets under n_srv (kalamu add --parent n_srv --text "..."), then mark the discussion done (kalamu done n_srv).',
      ].join("\n"),
    );
  });

  it("omits the subtree block entirely on a childless discussion", () => {
    const prompt = discussionPrompt(discussionTree, "n_leaf", "n_leaf");
    expect(prompt).toContain("Kalamu discussion n_leaf: Monorepo or polyrepo\n\nThis is for discussion only");
    expect(prompt).not.toContain("\n\n\n");
  });

  it("returns null for non-discussions and unknown ids", () => {
    expect(discussionPrompt(tree, "n_1", "n_1")).toBeNull();
    expect(discussionPrompt(discussionTree, "n_missing", "n_missing")).toBeNull();
  });
});
