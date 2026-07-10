import { describe, expect, it } from "vitest";
import {
  addNode,
  cleanDone,
  clearHandoff,
  deleteNode,
  markDone,
  moveNode,
  OperationError,
  reopen,
  searchNodes,
  setHandoff,
  updateNode,
} from "../src/operations.js";
import { bullet, task } from "./helpers.js";

const NOW = "2026-07-09T09:00:00.000Z";

describe("addNode", () => {
  it("adds top-level bullet by default and never stores default priority", () => {
    const { nodes, node } = addNode([], { text: "Auth", priority: 3, now: NOW });
    expect(node.kind).toBe("bullet");
    expect(node.parentId).toBeNull();
    expect(node.priority).toBeUndefined();
    expect(nodes).toEqual([node]);
  });

  it("appends as last sibling; supports --after and --before", () => {
    let state = addNode([], { text: "parent", now: NOW });
    const parent = state.node;
    const a = addNode(state.nodes, { parentId: parent.id, text: "a", now: NOW });
    const b = addNode(a.nodes, { parentId: parent.id, text: "b", now: NOW });
    const mid = addNode(b.nodes, { parentId: parent.id, text: "mid", afterId: a.node.id, now: NOW });
    expect(mid.nodes.map((n) => n.text)).toEqual(["parent", "a", "mid", "b"]);
    const first = addNode(mid.nodes, { parentId: parent.id, text: "first", beforeId: a.node.id, now: NOW });
    expect(first.nodes.map((n) => n.text)).toEqual(["parent", "first", "a", "mid", "b"]);
  });

  it("rejects unknown parent; --tag appends inline #tokens, lowercased and deduped", () => {
    expect(() => addNode([], { parentId: "nope", text: "x" })).toThrow(OperationError);
    const { node } = addNode([], { kind: "task", text: "x", tags: ["Backend", "backend", "api"], now: NOW });
    expect(node.text).toBe("x #backend #api");
    expect("tags" in node).toBe(false);
    expect(() => addNode([], { text: "x", tags: ["has space"], now: NOW })).toThrow(/invalid tag/);
  });
});

describe("updateNode", () => {
  it("updates text, kind, priority; --p default removes stored priority", () => {
    const start = [task("n_001", { priority: 1 })];
    let result = updateNode(start, "n_001", { text: "new", priority: "default" });
    expect(result.node.text).toBe("new");
    expect(result.node.priority).toBeUndefined();
    result = updateNode(result.nodes, "n_001", { priority: 3 });
    expect(result.node.priority).toBeUndefined();
    result = updateNode(result.nodes, "n_001", { priority: 5 });
    expect(result.node.priority).toBe(5);
  });

  it("preserves doneAt/handoff/priority when converting task to bullet", () => {
    const start = [task("n_001", { doneAt: NOW, priority: 1 })];
    const { node } = updateNode(start, "n_001", { kind: "bullet" });
    expect(node.doneAt).toBe(NOW);
    expect(node.priority).toBe(1);
  });

  it("adds and removes tags as text surgery on inline #tokens", () => {
    const start = [task("n_001", { text: "thing #a #b" })];
    let result = updateNode(start, "n_001", { addTags: ["c"], removeTags: ["a"] });
    expect(result.node.text).toBe("thing #b #c");
    result = updateNode(result.nodes, "n_001", { removeTags: ["b", "c"] });
    expect(result.node.text).toBe("thing");
    // idempotent add: token already present mid-sentence is not duplicated
    const mid = updateNode([task("n_002", { text: "Build a new #feature to do xyz" })], "n_002", {
      addTags: ["feature"],
    });
    expect(mid.node.text).toBe("Build a new #feature to do xyz");
  });

  it("sets and clears self", () => {
    const start = [task("n_001")];
    let result = updateNode(start, "n_001", { self: true });
    expect(result.node.self).toBe(true);
    result = updateNode(result.nodes, "n_001", { self: false });
    expect(result.node.self).toBeUndefined();
  });
});

describe("moveNode", () => {
  const forest = () => [
    bullet("n_001", { text: "A" }),
    task("n_002", { parentId: "n_001", text: "A1" }),
    task("n_003", { parentId: "n_002", text: "A1a" }),
    bullet("n_004", { text: "B" }),
  ];

  it("moves a subtree as a block and preserves children", () => {
    const { nodes } = moveNode(forest(), "n_002", { parentId: "n_004" });
    expect(nodes.map((n) => n.id)).toEqual(["n_001", "n_004", "n_002", "n_003"]);
    expect(nodes.find((n) => n.id === "n_003")?.parentId).toBe("n_002");
  });

  it("cannot move under itself or its own descendant", () => {
    expect(() => moveNode(forest(), "n_002", { parentId: "n_002" })).toThrow(OperationError);
    expect(() => moveNode(forest(), "n_001", { parentId: "n_003" })).toThrow(OperationError);
  });

  it("repositions among siblings with --before", () => {
    const base = [bullet("n_001"), bullet("n_002"), bullet("n_003")];
    const { nodes } = moveNode(base, "n_003", { parentId: null, beforeId: "n_001" });
    expect(nodes.map((n) => n.id)).toEqual(["n_003", "n_001", "n_002"]);
  });

  it("rejects --after that is not a sibling under the target parent", () => {
    expect(() => moveNode(forest(), "n_004", { parentId: "n_001", afterId: "n_003" })).toThrow(OperationError);
  });
});

describe("deleteNode", () => {
  it("deletes a leaf immediately, refuses children without recursive", () => {
    const nodes = [bullet("n_001"), task("n_002", { parentId: "n_001" })];
    expect(() => deleteNode(nodes, "n_001")).toThrow(/--recursive/);
    const leaf = deleteNode(nodes, "n_002");
    expect(leaf.deletedCount).toBe(1);
    expect(leaf.nodes.map((n) => n.id)).toEqual(["n_001"]);
  });

  it("recursive deletes the whole subtree", () => {
    const nodes = [
      bullet("n_001"),
      task("n_002", { parentId: "n_001" }),
      task("n_003", { parentId: "n_002" }),
      bullet("n_004"),
    ];
    const { nodes: remaining, deletedCount } = deleteNode(nodes, "n_001", { recursive: true });
    expect(deletedCount).toBe(3);
    expect(remaining.map((n) => n.id)).toEqual(["n_004"]);
  });
});

describe("done / reopen / handoff", () => {
  it("done sets doneAt on tasks only", () => {
    const { node } = markDone([task("n_001")], "n_001", NOW);
    expect(node.doneAt).toBe(NOW);
    expect(() => markDone([bullet("n_001")], "n_001", NOW)).toThrow(/bullet/);
  });

  it("reopen clears doneAt", () => {
    const { node } = reopen([task("n_001", { doneAt: NOW })], "n_001");
    expect(node.doneAt).toBeNull();
  });

  it("handoff stores at/target/ref, tasks only", () => {
    const { node } = setHandoff([task("n_001")], "n_001", "github", "https://github.com/x/1", NOW);
    expect(node.handoff).toEqual({ at: NOW, target: "github", ref: "https://github.com/x/1" });
    expect(() => setHandoff([bullet("n_001")], "n_001", "github", "x", NOW)).toThrow(/bullet/);
  });

  it("clearHandoff removes the record; errors on bullets and unhanded-off tasks", () => {
    const handed = task("n_001", { handoff: { at: NOW, target: "github", ref: "#1" } });
    const { node } = clearHandoff([handed], "n_001");
    expect(node.handoff).toBeNull();
    expect(() => clearHandoff([bullet("n_001")], "n_001")).toThrow(/bullet/);
    expect(() => clearHandoff([task("n_001")], "n_001")).toThrow(/no handoff/);
  });
});

describe("cleanDone", () => {
  it("removes done tasks with their whole subtrees, keeps everything else", () => {
    const nodes = [
      bullet("n_001", { text: "keep bullet" }),
      task("n_002", { parentId: "n_001", doneAt: NOW }),
      task("n_003", { parentId: "n_002", text: "open child of done parent" }),
      bullet("n_004", { parentId: "n_002" }),
      task("n_005", { text: "open stays" }),
      task("n_006", { text: "handed off stays", handoff: { at: NOW, target: "github", ref: "#1" } }),
    ];
    const { nodes: remaining, removed, doneTasks } = cleanDone(nodes);
    expect(remaining.map((n) => n.id)).toEqual(["n_001", "n_005", "n_006"]);
    expect(removed.map((n) => n.id)).toEqual(["n_002", "n_003", "n_004"]);
    expect(doneTasks).toBe(1);
  });

  it("is a no-op when nothing is done", () => {
    const nodes = [bullet("n_001"), task("n_002")];
    const result = cleanDone(nodes);
    expect(result.nodes).toHaveLength(2);
    expect(result.removed).toEqual([]);
    expect(result.doneTasks).toBe(0);
  });

  it("counts nested done tasks inside a removed subtree", () => {
    const nodes = [
      task("n_001", { doneAt: NOW }),
      task("n_002", { parentId: "n_001", doneAt: NOW }),
    ];
    const result = cleanDone(nodes);
    expect(result.nodes).toEqual([]);
    expect(result.doneTasks).toBe(2);
  });
});

describe("searchNodes", () => {
  it("case-insensitive substring over text, in outline order", () => {
    const nodes = [
      bullet("n_001", { text: "Auth improvements" }),
      task("n_002", { parentId: "n_001", text: "Fix OAuth redirect" }),
      task("n_003", { text: "Unrelated" }),
    ];
    expect(searchNodes(nodes, "auth").map((n) => n.id)).toEqual(["n_001", "n_002"]);
  });
});
