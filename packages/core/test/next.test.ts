import { describe, expect, it } from "vitest";
import { eligibleTasks, nextTask } from "../src/operations.js";
import { bullet, discussion, task } from "./helpers.js";

describe("nextTask", () => {
  it("p1 task beats p3 task regardless of outline position", () => {
    const nodes = [task("n_001", { priority: 3 }), task("n_002", { priority: 1 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("p1 task beats default (p2) task", () => {
    const nodes = [task("n_001"), task("n_002", { priority: 1 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("two p1 tasks preserve outline order", () => {
    const nodes = [task("n_001", { priority: 1 }), task("n_002", { priority: 1 })];
    const result = nextTask(nodes);
    expect(result?.node.id).toBe("n_001");
    expect(result?.reason).toContain("tie-breaker");
  });

  it("done tasks are ignored", () => {
    const nodes = [task("n_001", { priority: 1, doneAt: "2026-07-09T08:00:00.000Z" }), task("n_002")];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("human-assigned tasks are ignored", () => {
    const nodes = [task("n_001", { priority: 1, assignee: "human" }), task("n_002", { priority: 3 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("agent-assigned and unassigned tasks are equally eligible", () => {
    const nodes = [task("n_001", { assignee: "agent" }), task("n_002")];
    expect(eligibleTasks(nodes).map((e) => e.node.id)).toEqual(["n_001", "n_002"]);
  });

  it("bullet nodes are ignored", () => {
    const nodes = [bullet("n_001"), task("n_002")];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("blank-text tasks are ignored", () => {
    const nodes = [task("n_001", { text: "", priority: 1 }), task("n_002", { text: "  \t" }), task("n_003", { priority: 3 })];
    expect(nextTask(nodes)?.node.id).toBe("n_003");
    expect(eligibleTasks(nodes).map((e) => e.node.id)).toEqual(["n_003"]);
  });

  it("tasks under a done parent task are ignored", () => {
    const nodes = [
      task("n_001", { doneAt: "2026-07-09T08:00:00.000Z" }),
      task("n_002", { parentId: "n_001", priority: 1 }),
      task("n_003", { priority: 3 }),
    ];
    expect(nextTask(nodes)?.node.id).toBe("n_003");
  });

  it("bullet ancestors never affect eligibility", () => {
    const nodes = [bullet("n_001"), task("n_002", { parentId: "n_001", priority: 1 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("returns null when nothing is eligible", () => {
    const nodes = [bullet("n_001"), task("n_002", { assignee: "human" })];
    expect(nextTask(nodes)).toBeNull();
  });

  it("returns the ancestor path root-first", () => {
    const nodes = [
      bullet("n_001", { text: "Auth improvements" }),
      bullet("n_002", { parentId: "n_001", text: "Login UX" }),
      task("n_003", { parentId: "n_002", text: "Fix redirect", priority: 1 }),
    ];
    expect(nextTask(nodes)?.path).toEqual(["Auth improvements", "Login UX"]);
  });
});

describe("nextTask options", () => {
  it("--under scopes to the subtree, including the root node itself", () => {
    const nodes = [
      task("n_001", { priority: 1 }),
      bullet("n_002"),
      task("n_003", { parentId: "n_002", priority: 3 }),
    ];
    expect(nextTask(nodes, { under: "n_002" })?.node.id).toBe("n_003");
    expect(nextTask(nodes, { under: "n_001" })?.node.id).toBe("n_001");
  });

  it("--under an unknown id throws", () => {
    expect(() => nextTask([task("n_001")], { under: "n_404" })).toThrow(/n_404/);
  });

  it("--under with no eligible task in the subtree returns null", () => {
    const nodes = [task("n_001", { priority: 1 }), bullet("n_002")];
    expect(nextTask(nodes, { under: "n_002" })).toBeNull();
  });

  it("kind: discussion queues discussions with the same sort, skipping tasks entirely", () => {
    const nodes = [
      task("n_001", { priority: 1 }),
      discussion("n_002", { priority: 3 }),
      discussion("n_003", { priority: 1 }),
      discussion("n_004", { doneAt: "2026-07-09T08:00:00.000Z" }),
      discussion("n_005", { text: "  " }),
    ];
    expect(eligibleTasks(nodes, { kind: "discussion" }).map((e) => e.node.id)).toEqual(["n_003", "n_002"]);
    const result = nextTask(nodes, { kind: "discussion" });
    expect(result?.node.id).toBe("n_003");
    expect(result?.reason).toBe("highest-priority open discussion");
  });

  it("kind: discussion respects closed task umbrellas but ignores an inert assignee", () => {
    const nodes = [
      task("n_001", { doneAt: "2026-07-09T08:00:00.000Z" }),
      discussion("n_002", { parentId: "n_001", priority: 1 }),
      // an assignee left over from a past life as a task is inert on discussions
      discussion("n_003", { priority: 2, assignee: "human" }),
    ];
    expect(eligibleTasks(nodes, { kind: "discussion" }).map((e) => e.node.id)).toEqual(["n_003"]);
  });
});
