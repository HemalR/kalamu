import { describe, expect, it } from "vitest";
import {
  addNode,
  cleanDone,
  clearHandoff,
  deleteNode,
  markDone,
  moveNode,
  nextTask,
  OperationError,
  reopen,
  searchNodes,
  setHandoff,
  updateNode,
} from "../src/operations.js";
import { bullet, discussion, task } from "./helpers.js";

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

  it("an explicit priority makes the new node a task unless a kind is given", () => {
    const { node } = addNode([], { text: "urgent thing", priority: 1, now: NOW });
    expect(node.kind).toBe("task");
    const explicit = addNode([], { kind: "bullet", text: "note", priority: 1, now: NOW });
    expect(explicit.node.kind).toBe("bullet");
    expect(explicit.node.priority).toBe(1);
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

  it("setting a priority converts a bullet into a task; clearing or an explicit kind does not", () => {
    const converted = updateNode([bullet("n_001")], "n_001", { priority: 1 });
    expect(converted.node.kind).toBe("task");
    expect(converted.node.priority).toBe(1);
    const cleared = updateNode([bullet("n_002")], "n_002", { priority: "default" });
    expect(cleared.node.kind).toBe("bullet");
    const explicit = updateNode([bullet("n_003")], "n_003", { priority: 2, kind: "bullet" });
    expect(explicit.node.kind).toBe("bullet");
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

  it("sets and clears the assignee", () => {
    const start = [task("n_001")];
    let result = updateNode(start, "n_001", { assignee: "human" });
    expect(result.node.assignee).toBe("human");
    result = updateNode(result.nodes, "n_001", { assignee: "agent" });
    expect(result.node.assignee).toBe("agent");
    result = updateNode(result.nodes, "n_001", { assignee: null });
    expect(result.node.assignee).toBeUndefined();
  });
});

describe("discussions", () => {
  it("keep their kind when a priority is set, and carry it", () => {
    const added = addNode([], { kind: "discussion", text: "WorkOS or Auth0?", priority: 2, now: NOW });
    expect(added.node.kind).toBe("discussion");
    expect(added.node.priority).toBe(2);
    const updated = updateNode([discussion("n_001")], "n_001", { priority: 1 });
    expect(updated.node.kind).toBe("discussion");
    expect(updated.node.priority).toBe(1);
  });

  it("cannot be assigned — they involve both parties", () => {
    expect(() => addNode([], { kind: "discussion", text: "x", assignee: "human", now: NOW })).toThrow(
      /only tasks can be assigned/,
    );
    expect(() => updateNode([discussion("n_001")], "n_001", { assignee: "agent" })).toThrow(
      /only tasks can be assigned/,
    );
    // clearing is always safe, e.g. on a task being converted in the same call
    const cleared = updateNode([discussion("n_001", { assignee: "human" })], "n_001", { assignee: null });
    expect(cleared.node.assignee).toBeUndefined();
  });

  it("cannot be handed off", () => {
    expect(() => setHandoff([discussion("n_001")], "n_001", "github", "url", NOW)).toThrow(
      /only tasks can be handed off/,
    );
  });

  it("never surface in next, and a done discussion never closes its umbrella", () => {
    const nodes = [
      discussion("n_001", { text: "Talk it over", priority: 1, doneAt: NOW }),
      task("n_002", { parentId: "n_001", text: "Follow-up from the discussion" }),
    ];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
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
  it("done sets doneAt on tasks and bullets alike", () => {
    const { node } = markDone([task("n_001")], "n_001", NOW);
    expect(node.doneAt).toBe(NOW);
    const struck = markDone([bullet("n_001")], "n_001", NOW);
    expect(struck.node.doneAt).toBe(NOW);
  });

  it("reopen clears doneAt", () => {
    const { node } = reopen([task("n_001", { doneAt: NOW })], "n_001");
    expect(node.doneAt).toBeNull();
    expect(reopen([bullet("n_001", { doneAt: NOW })], "n_001").node.doneAt).toBeNull();
  });

  it("a done bullet never gates eligibility: descendants stay in next", () => {
    const nodes = [bullet("n_001", { doneAt: NOW }), task("n_002", { parentId: "n_001", priority: 1 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
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
    expect(result.doneBullets).toBe(0);
    expect(result.blankNodes).toBe(0);
  });

  it("removes done bullets, including fully-done chains", () => {
    const nodes = [
      bullet("n_001", { doneAt: NOW }),
      bullet("n_002", { parentId: "n_001", doneAt: NOW }),
      bullet("n_003"),
    ];
    const result = cleanDone(nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["n_003"]);
    expect(result.doneBullets).toBe(2);
    expect(result.doneTasks).toBe(0);
  });

  it("keeps a done bullet whose children survive", () => {
    const nodes = [
      bullet("n_001", { doneAt: NOW }),
      task("n_002", { parentId: "n_001", text: "open task stays eligible" }),
      bullet("n_003", { parentId: "n_001", doneAt: NOW }),
    ];
    const result = cleanDone(nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["n_001", "n_002"]);
    expect(result.doneBullets).toBe(1);
  });

  it("removes a done bullet whose only children are done tasks", () => {
    const nodes = [bullet("n_001", { doneAt: NOW }), task("n_002", { parentId: "n_001", doneAt: NOW })];
    const result = cleanDone(nodes);
    expect(result.nodes).toEqual([]);
    expect(result.doneTasks).toBe(1);
    expect(result.doneBullets).toBe(1);
  });

  it("treats done discussions like done bullets: removed alone, kept while children survive", () => {
    const nodes = [
      discussion("n_001", { doneAt: NOW }),
      bullet("n_002", { parentId: "n_001", text: "recorded outcome survives" }),
      discussion("n_003", { doneAt: NOW }),
    ];
    const result = cleanDone(nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["n_001", "n_002"]);
    expect(result.doneDiscussions).toBe(1);
    expect(result.doneBullets).toBe(0);
  });

  it("removes blank nodes of either kind", () => {
    const nodes = [task("n_001", { text: "" }), bullet("n_002", { text: "  " }), bullet("n_003")];
    const result = cleanDone(nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["n_003"]);
    expect(result.blankNodes).toBe(2);
    expect(result.doneTasks).toBe(0);
  });

  it("keeps a blank node whose children survive, collapses fully blank chains", () => {
    const nodes = [
      bullet("n_001", { text: "" }),
      task("n_002", { parentId: "n_001", text: "real child stays" }),
      bullet("n_003", { text: "" }),
      bullet("n_004", { parentId: "n_003", text: "" }),
    ];
    const result = cleanDone(nodes);
    expect(result.nodes.map((n) => n.id)).toEqual(["n_001", "n_002"]);
    expect(result.blankNodes).toBe(2);
  });

  it("removes a blank node whose only children are done tasks", () => {
    const nodes = [bullet("n_001", { text: "" }), task("n_002", { parentId: "n_001", doneAt: NOW })];
    const result = cleanDone(nodes);
    expect(result.nodes).toEqual([]);
    expect(result.doneTasks).toBe(1);
    expect(result.blankNodes).toBe(1);
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
