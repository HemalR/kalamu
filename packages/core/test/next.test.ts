import { describe, expect, it } from "vitest";
import { eligibleTasks, nextTask } from "../src/operations.js";
import { bullet, task } from "./helpers.js";

describe("nextTask", () => {
  it("p1 task beats p2 task regardless of outline position", () => {
    const nodes = [task("n_001", { priority: 2 }), task("n_002", { priority: 1 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("p2 task beats default (p3) task", () => {
    const nodes = [task("n_001"), task("n_002", { priority: 2 })];
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

  it("handed-off tasks are ignored", () => {
    const nodes = [
      task("n_001", { priority: 1, handoff: { at: "2026-07-09T08:00:00.000Z", target: "github", ref: "#1" } }),
      task("n_002"),
    ];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("self tasks are ignored", () => {
    const nodes = [task("n_001", { priority: 1, self: true }), task("n_002", { priority: 5 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("bullet nodes are ignored", () => {
    const nodes = [bullet("n_001"), task("n_002")];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("tasks under a done parent task are ignored", () => {
    const nodes = [
      task("n_001", { doneAt: "2026-07-09T08:00:00.000Z" }),
      task("n_002", { parentId: "n_001", priority: 1 }),
      task("n_003", { priority: 5 }),
    ];
    expect(nextTask(nodes)?.node.id).toBe("n_003");
  });

  it("tasks under a handed-off parent task are ignored", () => {
    const nodes = [
      task("n_001", { handoff: { at: "2026-07-09T08:00:00.000Z", target: "linear", ref: "ENG-1" } }),
      task("n_002", { parentId: "n_001", priority: 1 }),
      task("n_003"),
    ];
    expect(nextTask(nodes)?.node.id).toBe("n_003");
  });

  it("bullet ancestors never affect eligibility", () => {
    const nodes = [bullet("n_001"), task("n_002", { parentId: "n_001", priority: 1 })];
    expect(nextTask(nodes)?.node.id).toBe("n_002");
  });

  it("returns null when nothing is eligible", () => {
    const nodes = [bullet("n_001"), task("n_002", { self: true })];
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
  const HANDOFF = { at: "2026-07-09T08:00:00.000Z", target: "github", ref: "#1" };

  it("--under scopes to the subtree, including the root node itself", () => {
    const nodes = [
      task("n_001", { priority: 1 }),
      bullet("n_002"),
      task("n_003", { parentId: "n_002", priority: 5 }),
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

  it("includeHandedOff readmits handed-off tasks and handed-off umbrellas", () => {
    const nodes = [
      task("n_001", { priority: 1, handoff: HANDOFF }),
      task("n_002", { parentId: "n_001", priority: 2 }),
      task("n_003", { priority: 5 }),
    ];
    expect(nextTask(nodes)?.node.id).toBe("n_003");
    expect(nextTask(nodes, { includeHandedOff: true })?.node.id).toBe("n_001");
    expect(eligibleTasks(nodes, { includeHandedOff: true }).map((e) => e.node.id)).toEqual([
      "n_001",
      "n_002",
      "n_003",
    ]);
  });

  it("includeHandedOff still excludes done tasks and done umbrellas", () => {
    const nodes = [
      task("n_001", { priority: 1, doneAt: "2026-07-09T08:00:00.000Z", handoff: HANDOFF }),
      task("n_002", { parentId: "n_001", priority: 1 }),
      task("n_003", { priority: 5 }),
    ];
    expect(nextTask(nodes, { includeHandedOff: true })?.node.id).toBe("n_003");
  });

  it("options compose: under + includeHandedOff", () => {
    const nodes = [
      task("n_001", { priority: 1, handoff: HANDOFF }),
      bullet("n_002"),
      task("n_003", { parentId: "n_002", priority: 4, handoff: HANDOFF }),
      task("n_004", { parentId: "n_002", priority: 5 }),
    ];
    expect(nextTask(nodes, { under: "n_002", includeHandedOff: true })?.node.id).toBe("n_003");
  });
});
