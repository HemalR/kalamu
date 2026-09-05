import { describe, expect, it } from "vitest";
import { headingSlug, markdownHeadings, markdownSection, serializeMarkdown } from "../src/markdown.js";
import { buildTree } from "../src/tree.js";
import { bullet, discussion, task } from "./helpers.js";

const NOW = "2026-07-09T09:00:00.000Z";

describe("serializeMarkdown", () => {
  it("renders the canonical Markdown outline format", () => {
    const nodes = [
      bullet("n_001", { text: "Auth improvements #auth" }),
      task("n_002", { parentId: "n_001", text: "Fix redirect", priority: 1 }),
      task("n_003", { parentId: "n_002", text: "Write tests", doneAt: NOW }),
      task("n_004", { parentId: "n_001", text: "Blog post", assignee: "human" }),
      task("n_005", { parentId: "n_001", text: "Audit logs" }),
      discussion("n_006", { parentId: "n_001", text: "WorkOS or Auth0?", priority: 3 }),
      discussion("n_007", { parentId: "n_006", text: "Settled: WorkOS", doneAt: NOW }),
    ];
    const tree = buildTree(nodes);
    const root = tree.byId.get("n_001");
    expect(root && serializeMarkdown(tree, [root])).toBe(
      [
        "- Auth improvements #auth",
        "  - [ ] p1 Fix redirect",
        "    - [x] Write tests",
        "  - [ ] Blog post @human",
        "  - [ ] Audit logs",
        "  - [?] p3 WorkOS or Auth0?",
        "    - [x?] Settled: WorkOS",
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

describe("headingSlug / markdownHeadings", () => {
  it("slugs GitHub-style and skips fenced code", () => {
    expect(headingSlug("Phase 2: Admin Console!")).toBe("phase-2-admin-console");
    const source = "# Plan\n\ntext\n```\n# not a heading\n```\n## Phase 2 ##\n";
    expect(markdownHeadings(source)).toEqual([
      { level: 1, text: "Plan", slug: "plan", line: 0 },
      { level: 2, text: "Phase 2", slug: "phase-2", line: 6 },
    ]);
  });
});

describe("markdownSection", () => {
  const source = "# Plan\nintro\n## Phase 1\none\n### Detail\ndeep\n## Phase 2\ntwo\n";
  it("slices a heading through to the next heading of the same or higher level", () => {
    expect(markdownSection(source, "phase-1")).toBe("## Phase 1\none\n### Detail\ndeep");
    expect(markdownSection(source, "phase-2")).toBe("## Phase 2\ntwo");
    expect(markdownSection(source, "plan")).toBe(source.trimEnd());
  });
  it("returns the whole doc without an anchor and null for an unknown one", () => {
    expect(markdownSection(source)).toBe(source);
    expect(markdownSection(source, "nope")).toBeNull();
  });
});
