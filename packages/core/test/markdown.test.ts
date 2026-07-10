import { describe, expect, it } from "vitest";
import { serializeMarkdown } from "../src/markdown.js";
import { buildTree } from "../src/tree.js";
import { bullet, task } from "./helpers.js";

const NOW = "2026-07-09T09:00:00.000Z";

describe("serializeMarkdown", () => {
  it("renders the canonical shared format (CLI show --format markdown == web Cmd+C)", () => {
    const nodes = [
      bullet("n_001", { text: "Auth improvements #auth" }),
      task("n_002", { parentId: "n_001", text: "Fix redirect", priority: 1 }),
      task("n_003", { parentId: "n_002", text: "Write tests", doneAt: NOW }),
      task("n_004", { parentId: "n_001", text: "Blog post", self: true }),
      task("n_005", {
        parentId: "n_001",
        text: "Audit logs",
        handoff: { at: NOW, target: "github", ref: "#42" },
      }),
    ];
    const tree = buildTree(nodes);
    const root = tree.byId.get("n_001");
    expect(root && serializeMarkdown(tree, [root])).toBe(
      [
        "- Auth improvements #auth",
        "  - [ ] p1 Fix redirect",
        "    - [x] Write tests",
        "  - [ ] Blog post (self)",
        "  - [ ] Audit logs → github:#42",
      ].join("\n"),
    );
  });

  it("maxDepth 0 is the root line only; maxDepth 1 stops after direct children", () => {
    const nodes = [
      bullet("n_001", { text: "root" }),
      bullet("n_002", { parentId: "n_001", text: "child" }),
      bullet("n_003", { parentId: "n_002", text: "grandchild" }),
    ];
    const tree = buildTree(nodes);
    const root = tree.byId.get("n_001");
    expect(root && serializeMarkdown(tree, [root], 0)).toBe("- root");
    expect(root && serializeMarkdown(tree, [root], 1)).toBe("- root\n  - child");
  });
});
