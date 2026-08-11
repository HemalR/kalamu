import { describe, expect, it } from "vitest";
import { progressByNode, progressOf } from "../src/progress.js";
import { buildTree } from "../src/tree.js";
import { bullet, discussion, task } from "./helpers.js";

const DONE = "2026-07-09T08:00:00.000Z";
const STARTED = "2026-07-09T07:30:00.000Z";

const progress = (nodes: Parameters<typeof buildTree>[0], id: string | null) => progressOf(buildTree(nodes), id);

describe("progressOf", () => {
  it("can count only tasks while preserving done-task subtree closure", () => {
    const nodes = [
      bullet("n_root"),
      task("n_a", { parentId: "n_root", doneAt: DONE }),
      task("n_b", { parentId: "n_a" }),
      discussion("n_c", { parentId: "n_root" }),
      task("n_d", { parentId: "n_root" }),
    ];
    expect(progressOf(buildTree(nodes), null, { kind: "task" })).toEqual({ total: 3, done: 2, active: 0 });
  });

  it("counts tasks and discussions under a bullet, but not the bullet", () => {
    const nodes = [
      bullet("n_root"),
      task("n_a", { parentId: "n_root", doneAt: DONE }),
      discussion("n_b", { parentId: "n_root" }),
      bullet("n_c", { parentId: "n_root" }),
    ];
    expect(progress(nodes, "n_root")).toEqual({ total: 2, done: 1, active: 0 });
  });

  it("an actionable parent does not count itself", () => {
    const nodes = [task("n_root"), task("n_a", { parentId: "n_root", doneAt: DONE })];
    expect(progress(nodes, "n_root")).toEqual({ total: 1, done: 1, active: 0 });
  });

  it("counts actionable descendants at every depth", () => {
    const nodes = [
      bullet("n_root"),
      bullet("n_child", { parentId: "n_root" }),
      task("n_grandchild", { parentId: "n_child" }),
      discussion("n_great_grandchild", { parentId: "n_grandchild", doneAt: DONE }),
    ];
    expect(progress(nodes, "n_root")).toEqual({ total: 2, done: 1, active: 0 });
  });

  it("a done ancestor task closes its subtree, so everything below counts done", () => {
    const nodes = [
      task("n_root", { doneAt: DONE }),
      task("n_a", { parentId: "n_root" }),
      task("n_b", { parentId: "n_a" }),
    ];
    expect(progress(nodes, "n_root")).toEqual({ total: 2, done: 2, active: 0 });
    // Nodes inside the closed subtree read as complete in their own right.
    expect(progress(nodes, "n_a")).toEqual({ total: 1, done: 1, active: 0 });
  });

  it("a done discussion closes nothing — its children keep counting", () => {
    const nodes = [
      discussion("n_root", { doneAt: DONE }),
      task("n_a", { parentId: "n_root" }),
      bullet("n_b", { parentId: "n_root" }),
    ];
    expect(progress(nodes, "n_root")).toEqual({ total: 1, done: 0, active: 0 });
  });

  it("a done bullet closes nothing and never counts itself", () => {
    const nodes = [bullet("n_root", { doneAt: DONE }), task("n_a", { parentId: "n_root" })];
    expect(progress(nodes, "n_root")).toEqual({ total: 1, done: 0, active: 0 });
  });

  it("blank rows are half-typed, not work", () => {
    const nodes = [bullet("n_root"), task("n_a", { parentId: "n_root", text: "   " })];
    expect(progress(nodes, "n_root")).toEqual({ total: 0, done: 0, active: 0 });
  });

  it("human-assigned tasks count — they are invisible to next, not to the human", () => {
    const nodes = [bullet("n_root"), task("n_a", { parentId: "n_root", assignee: "human" })];
    expect(progress(nodes, "n_root")).toEqual({ total: 1, done: 0, active: 0 });
  });

  it("a leaf task has no descendant units", () => {
    expect(progress([task("n_a")], "n_a")).toEqual({ total: 0, done: 0, active: 0 });
  });

  it("null totals the whole outline", () => {
    const nodes = [
      bullet("n_r1"),
      task("n_a", { parentId: "n_r1", doneAt: DONE }),
      task("n_r2"),
      discussion("n_r3", { doneAt: DONE }),
    ];
    expect(progress(nodes, null)).toEqual({ total: 3, done: 2, active: 0 });
  });

  it("a claimed open task counts as active, not done", () => {
    const nodes = [
      bullet("n_root"),
      task("n_a", { parentId: "n_root", startedAt: STARTED }),
      task("n_b", { parentId: "n_root", doneAt: DONE }),
      task("n_c", { parentId: "n_root" }),
    ];
    expect(progress(nodes, "n_root")).toEqual({ total: 3, done: 1, active: 1 });
  });

  it("a claim on a finished descendant is spent — done wins over active", () => {
    const nodes = [bullet("n_root"), task("n_a", { parentId: "n_root", startedAt: STARTED, doneAt: DONE })];
    expect(progress(nodes, "n_root")).toEqual({ total: 1, done: 1, active: 0 });
  });

  it("a closed subtree has no active work left", () => {
    const nodes = [task("n_root", { doneAt: DONE }), task("n_a", { parentId: "n_root", startedAt: STARTED })];
    expect(progress(nodes, "n_root")).toEqual({ total: 1, done: 1, active: 0 });
  });

  it("an unknown id is empty, not a throw", () => {
    expect(progress([task("n_a")], "n_missing")).toEqual({ total: 0, done: 0, active: 0 });
  });
});

describe("progressByNode", () => {
  it("gives every node an entry in one pass", () => {
    const nodes = [
      bullet("n_root"),
      task("n_a", { parentId: "n_root" }),
      task("n_b", { parentId: "n_a", doneAt: DONE }),
    ];
    const map = progressByNode(buildTree(nodes));
    expect([...map.keys()].sort()).toEqual(["n_a", "n_b", "n_root"]);
    expect(map.get("n_a")).toEqual({ total: 1, done: 1, active: 0 });
    expect(map.get("n_b")).toEqual({ total: 0, done: 0, active: 0 });
  });
});
