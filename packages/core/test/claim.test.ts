/** startedAt claiming (SPEC key decision 17) and blockedBy (key decision 16). */
import { describe, expect, it } from "vitest";
import {
  addBlocker,
  cleanDone,
  deleteNode,
  dependsOn,
  eligibleTasks,
  endTask,
  markDone,
  nextTask,
  OperationError,
  removeBlocker,
  reopen,
  startTask,
  updateNode,
} from "../src/operations.js";
import { serializeNode } from "../src/jsonl.js";
import { nodeSchema } from "../src/model.js";
import { validateOutline } from "../src/validate.js";
import { bullet, discussion, task } from "./helpers.js";

const NOW = "2026-08-08T09:00:00.000Z";
const LATER = "2026-08-08T10:00:00.000Z";

describe("startTask / endTask", () => {
  it("sets startedAt and clears it again", () => {
    const started = startTask([task("n_001")], "n_001", {}, NOW);
    expect(started.node.startedAt).toBe(NOW);
    const ended = endTask(started.nodes, "n_001");
    expect(ended.node.startedAt).toBeUndefined();
    // Cleared, not stored as null — absent optionals never reach the file.
    expect(serializeNode(ended.node)).not.toContain("startedAt");
  });

  it("refuses non-tasks, done tasks, and a second claim without force", () => {
    expect(() => startTask([bullet("n_001")], "n_001")).toThrow(/only tasks can be started/);
    expect(() => startTask([discussion("n_001")], "n_001")).toThrow(/only tasks can be started/);
    expect(() => startTask([task("n_001", { doneAt: NOW })], "n_001")).toThrow(/already done/);

    const claimed = startTask([task("n_001")], "n_001", {}, NOW);
    expect(() => startTask(claimed.nodes, "n_001")).toThrow(/pass --force/);
  });

  it("--force re-claims a task whose owner died", () => {
    const claimed = startTask([task("n_001")], "n_001", {}, NOW);
    const reclaimed = startTask(claimed.nodes, "n_001", { force: true }, LATER);
    expect(reclaimed.node.startedAt).toBe(LATER);
  });

  it("errors when ending a task that was never started", () => {
    expect(() => endTask([task("n_001")], "n_001")).toThrow(/never started/);
  });

  it("done preserves startedAt as a record of how long the work took", () => {
    const claimed = startTask([task("n_001")], "n_001", {}, NOW);
    const finished = markDone(claimed.nodes, "n_001", LATER);
    expect(finished.node.startedAt).toBe(NOW);
    expect(finished.node.doneAt).toBe(LATER);
  });

  it("reopen drops the claim so the task returns to the queue", () => {
    const claimed = startTask([task("n_001")], "n_001", {}, NOW);
    const finished = markDone(claimed.nodes, "n_001", LATER);
    const reopened = reopen(finished.nodes, "n_001");
    expect(reopened.node.startedAt).toBeUndefined();
    expect(nextTask(reopened.nodes)?.node.id).toBe("n_001");
  });

  it("next skips a claimed task and returns it once ended", () => {
    const nodes = [task("n_001", { priority: 1 }), task("n_002", { priority: 3 })];
    const claimed = startTask(nodes, "n_001", {}, NOW);
    expect(nextTask(claimed.nodes)?.node.id).toBe("n_002");
    expect(nextTask(endTask(claimed.nodes, "n_001").nodes)?.node.id).toBe("n_001");
  });
});

describe("addBlocker / removeBlocker", () => {
  it("records the blocker on the blocked task only — no reverse field", () => {
    const { nodes, node } = addBlocker([task("n_001"), task("n_002")], "n_001", "n_002");
    expect(node.blockedBy).toEqual(["n_002"]);
    const blocker = nodes.find((n) => n.id === "n_002");
    expect(blocker && "blocks" in blocker).toBe(false);
  });

  it("is a no-op when the blocker is already recorded", () => {
    const once = addBlocker([task("n_001"), task("n_002")], "n_001", "n_002");
    const twice = addBlocker(once.nodes, "n_001", "n_002");
    expect(twice.node.blockedBy).toEqual(["n_002"]);
  });

  it("rejects self-blocking, missing nodes, and non-tasks", () => {
    expect(() => addBlocker([task("n_001")], "n_001", "n_001")).toThrow(/cannot block itself/);
    expect(() => addBlocker([task("n_001")], "n_001", "n_404")).toThrow(/n_404/);
    expect(() => addBlocker([bullet("n_001"), task("n_002")], "n_001", "n_002")).toThrow(/only tasks can be blocked/);
  });

  it("rejects a direct cycle", () => {
    const first = addBlocker([task("n_001"), task("n_002")], "n_001", "n_002");
    expect(() => addBlocker(first.nodes, "n_002", "n_001")).toThrow(/cycle/);
  });

  it("rejects a transitive cycle through a chain", () => {
    let nodes = [task("n_001"), task("n_002"), task("n_003")];
    nodes = addBlocker(nodes, "n_001", "n_002").nodes;
    nodes = addBlocker(nodes, "n_002", "n_003").nodes;
    expect(() => addBlocker(nodes, "n_003", "n_001")).toThrow(/cycle/);
  });

  it("removes one blocker, or all, dropping the field when empty", () => {
    let nodes = [task("n_001"), task("n_002"), task("n_003")];
    nodes = addBlocker(nodes, "n_001", "n_002").nodes;
    nodes = addBlocker(nodes, "n_001", "n_003").nodes;

    const one = removeBlocker(nodes, "n_001", "n_002");
    expect(one.node.blockedBy).toEqual(["n_003"]);

    const all = removeBlocker(nodes, "n_001");
    expect(all.node.blockedBy).toBeUndefined();
    expect(serializeNode(all.node)).not.toContain("blockedBy");
  });

  it("errors on removing a blocker that is not recorded", () => {
    const nodes = addBlocker([task("n_001"), task("n_002")], "n_001", "n_002").nodes;
    expect(() => removeBlocker(nodes, "n_001", "n_404")).toThrow(/not blocked by/);
    expect(() => removeBlocker([task("n_003")], "n_003")).toThrow(/no blockers/);
  });

  it("dependsOn walks the blocker graph transitively", () => {
    let nodes = [task("n_001"), task("n_002"), task("n_003")];
    nodes = addBlocker(nodes, "n_001", "n_002").nodes;
    nodes = addBlocker(nodes, "n_002", "n_003").nodes;
    expect(dependsOn(nodes, "n_001", "n_003")).toBe(true);
    expect(dependsOn(nodes, "n_003", "n_001")).toBe(false);
  });
});

describe("blockers and the queue", () => {
  it("an open blocker hides the task; finishing the blocker frees it", () => {
    const nodes = addBlocker([task("n_001", { priority: 1 }), task("n_002", { priority: 3 })], "n_001", "n_002").nodes;
    expect(nextTask(nodes)?.node.id).toBe("n_002");
    const unblocked = markDone(nodes, "n_002", NOW);
    expect(nextTask(unblocked.nodes)?.node.id).toBe("n_001");
  });

  it("a blocker in an unrelated subtree still blocks", () => {
    const nodes = [
      bullet("n_001"),
      task("n_002", { parentId: "n_001", priority: 1 }),
      bullet("n_003"),
      task("n_004", { parentId: "n_003" }),
    ];
    const blocked = addBlocker(nodes, "n_002", "n_004").nodes;
    expect(eligibleTasks(blocked).map((e) => e.node.id)).toEqual(["n_004"]);
  });

  it("a task blocked only by done nodes is eligible", () => {
    const nodes = [task("n_001", { priority: 1 }), task("n_002", { doneAt: NOW })];
    const blocked = addBlocker(nodes, "n_001", "n_002").nodes;
    expect(nextTask(blocked)?.node.id).toBe("n_001");
  });
});

describe("delete cleans up blocker references", () => {
  it("strips the deleted id and drops the field when it empties", () => {
    let nodes = [task("n_001"), task("n_002"), task("n_003")];
    nodes = addBlocker(nodes, "n_001", "n_002").nodes;
    nodes = addBlocker(nodes, "n_001", "n_003").nodes;

    const afterOne = deleteNode(nodes, "n_002").nodes;
    expect(afterOne.find((n) => n.id === "n_001")?.blockedBy).toEqual(["n_003"]);

    const afterBoth = deleteNode(afterOne, "n_003").nodes;
    expect(afterBoth.find((n) => n.id === "n_001")?.blockedBy).toBeUndefined();
  });

  it("cleans references to every node in a recursive delete", () => {
    let nodes = [bullet("n_001"), task("n_002", { parentId: "n_001" }), task("n_003")];
    nodes = addBlocker(nodes, "n_003", "n_002").nodes;
    const after = deleteNode(nodes, "n_001", { recursive: true }).nodes;
    expect(after.find((n) => n.id === "n_003")?.blockedBy).toBeUndefined();
  });
});

describe("clean cleans up blocker references", () => {
  it("strips the cleaned blocker and drops the field when it empties", () => {
    const nodes = addBlocker([task("n_001"), task("n_002", { doneAt: NOW })], "n_001", "n_002").nodes;
    const cleaned = cleanDone(nodes);
    expect(cleaned.nodes.map((n) => n.id)).toEqual(["n_001"]);
    // Not [] — an emptied blocker list never reaches the file.
    expect(serializeNode(cleaned.nodes[0]!)).not.toContain("blockedBy");
  });

  it("keeps the blockers the clean did not remove", () => {
    let nodes = [task("n_001"), task("n_002", { doneAt: NOW }), task("n_003")];
    nodes = addBlocker(nodes, "n_001", "n_002").nodes;
    nodes = addBlocker(nodes, "n_001", "n_003").nodes;
    expect(cleanDone(nodes).nodes.find((n) => n.id === "n_001")?.blockedBy).toEqual(["n_003"]);
  });
});

describe("kind conversion carries the claim and blockers inertly", () => {
  it("a claimed, blocked task keeps both fields as a bullet, and they gate again as a task", () => {
    let nodes = [task("n_001"), task("n_002")];
    nodes = addBlocker(nodes, "n_001", "n_002").nodes;
    nodes = startTask(nodes, "n_001", {}, NOW).nodes;

    const bulleted = updateNode(nodes, "n_001", { kind: "bullet" });
    expect(bulleted.node.startedAt).toBe(NOW);
    expect(bulleted.node.blockedBy).toEqual(["n_002"]);
    expect(eligibleTasks(bulleted.nodes).map((e) => e.node.id)).toEqual(["n_002"]);

    const retasked = updateNode(bulleted.nodes, "n_001", { kind: "task" });
    expect(eligibleTasks(retasked.nodes).map((e) => e.node.id)).toEqual(["n_002"]);
    const freed = markDone(endTask(retasked.nodes, "n_001").nodes, "n_002", LATER);
    expect(eligibleTasks(freed.nodes).map((e) => e.node.id)).toEqual(["n_001"]);
  });
});

describe("nodeSchema blockedBy", () => {
  const node = (blockedBy: string[]): Record<string, unknown> => ({
    id: "n_001",
    parentId: null,
    kind: "task",
    text: "x",
    createdAt: NOW,
    doneAt: null,
    blockedBy,
  });

  it("rejects an empty array — the field is omitted, never written as []", () => {
    expect(() => nodeSchema.parse(node([]))).toThrow(/omit the field instead/);
  });

  it("rejects the same blocker twice", () => {
    expect(() => nodeSchema.parse(node(["n_002", "n_002"]))).toThrow(/must not repeat/);
  });
});

describe("validate", () => {
  const line = (id: string, blockedBy?: string[]): string =>
    JSON.stringify({
      id,
      parentId: null,
      kind: "task",
      text: id,
      createdAt: NOW,
      doneAt: null,
      ...(blockedBy ? { blockedBy } : {}),
    });

  it("reports a blocker pointing at a missing node", () => {
    const result = validateOutline(`${line("n_001", ["n_404"])}\n`);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/blocked by missing node n_404/);
  });

  it("reports a blocker cycle", () => {
    const result = validateOutline(`${line("n_001", ["n_002"])}\n${line("n_002", ["n_001"])}\n`);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/blocker cycle/);
  });

  it("reports a self-blocker once — never also as a one-node cycle", () => {
    const result = validateOutline(`${line("n_001", ["n_001"])}\n`);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(["n_001 is blocked by itself"]);
  });

  it("accepts a legitimate cross-tree blocker", () => {
    const result = validateOutline(`${line("n_001", ["n_002"])}\n${line("n_002")}\n`);
    expect(result.valid).toBe(true);
  });
});
