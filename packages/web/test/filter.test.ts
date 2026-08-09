import { buildTree, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import {
  ASSIGNEE_VALUES,
  CREATED_BY_VALUES,
  filtersVisibleIds,
  matchesFilters,
  narrowedFilters,
  tagVisibleIds,
  toggleAxis,
} from "../src/lib/filter";

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

// root ─ mid(#backend) ─ leaf        <- match chain
//      └ other ─ otherleaf           <- unrelated subtree
// solo(#backend)                     <- root-level match
// unrelated-root
const tree = buildTree([
  node({ id: "root", text: "umbrella" }),
  node({ id: "mid", parentId: "root", text: "the #backend work" }),
  node({ id: "leaf", parentId: "mid", text: "detail" }),
  node({ id: "other", parentId: "root", text: "frontend" }),
  node({ id: "otherleaf", parentId: "other", text: "css" }),
  node({ id: "solo", text: "#backend infra" }),
  node({ id: "lone", text: "notes" }),
]);

describe("tagVisibleIds", () => {
  it("shows matches with their ancestors and descendants", () => {
    expect([...tagVisibleIds(tree, "backend")].sort()).toEqual(["leaf", "mid", "root", "solo"]);
  });

  it("returns empty when nothing matches", () => {
    expect(tagVisibleIds(tree, "nope").size).toBe(0);
  });

  it("handles nested matches without double-counting", () => {
    const nested = buildTree([
      node({ id: "a", text: "#x" }),
      node({ id: "b", parentId: "a", text: "also #x here" }),
      node({ id: "c", parentId: "b", text: "child" }),
    ]);
    expect([...tagVisibleIds(nested, "x")].sort()).toEqual(["a", "b", "c"]);
  });

  it("matches are case-insensitive via derived lowercase names", () => {
    const cased = buildTree([node({ id: "a", text: "ship #Backend now" })]);
    expect(tagVisibleIds(cased, "backend").has("a")).toBe(true);
  });
});

// root (bullet, human)
// ├ human-task    (task, human-written, assigned human)
// ├ agent-bullet  (bullet, agent-written)
// │  └ human-child (bullet, human-written)
// └ agent-task    (task, agent-written, assigned agent)
// loose           (task, human-written, unassigned)
const authored = buildTree([
  node({ id: "root" }),
  node({ id: "human-task", parentId: "root", kind: "task", assignee: "human" }),
  node({ id: "agent-bullet", parentId: "root", createdBy: "agent" }),
  node({ id: "human-child", parentId: "agent-bullet" }),
  node({ id: "agent-task", parentId: "root", kind: "task", createdBy: "agent", assignee: "agent" }),
  node({ id: "loose", kind: "task" }),
]);

const visible = (filters: Parameters<typeof filtersVisibleIds>[1]): string[] | null => {
  const ids = filtersVisibleIds(authored, filters);
  return ids === null ? null : [...ids].sort();
};

describe("filtersVisibleIds", () => {
  it("narrows nothing when both axes are absent", () => {
    expect(filtersVisibleIds(authored, {})).toBe(null);
  });

  it("narrows nothing when an axis lists every value", () => {
    expect(filtersVisibleIds(authored, { createdBy: [...CREATED_BY_VALUES] })).toBe(null);
    expect(filtersVisibleIds(authored, { assignee: [...ASSIGNEE_VALUES] })).toBe(null);
  });

  it("treats an absent createdBy as human", () => {
    // Only agent-bullet and agent-task carry createdBy; everything else is human.
    expect(visible({ createdBy: ["human"] })).toEqual([
      "agent-bullet", // ancestor of human-child
      "human-child",
      "human-task",
      "loose",
      "root",
    ]);
  });

  it("keeps ancestors of matches even when they don't match themselves", () => {
    const ids = filtersVisibleIds(authored, { createdBy: ["human"] });
    expect(ids?.has("agent-bullet")).toBe(true); // kept purely as human-child's parent
    expect(ids?.has("agent-task")).toBe(false); // no matching descendant
  });

  it("filters to agent-written nodes, keeping the structure above them", () => {
    expect(visible({ createdBy: ["agent"] })).toEqual(["agent-bullet", "agent-task", "root"]);
  });

  it("treats an absent assignee as unassigned", () => {
    expect(visible({ assignee: ["unassigned"] })).toEqual([
      "agent-bullet",
      "human-child",
      "loose", // the only unassigned task
      "root",
    ]);
  });

  it("never hides bullets or discussions on the assignee axis", () => {
    const mixed = buildTree([
      node({ id: "bullet" }),
      node({ id: "discussion", kind: "discussion" }),
      node({ id: "task", kind: "task", assignee: "agent" }),
    ]);
    expect([...(filtersVisibleIds(mixed, { assignee: ["human"] }) ?? [])].sort()).toEqual(["bullet", "discussion"]);
  });

  it("filters to human-assigned tasks", () => {
    expect(visible({ assignee: ["human"] })).toEqual(["agent-bullet", "human-child", "human-task", "root"]);
  });

  it("combines both axes, keeping ancestors of the survivors", () => {
    // loose is human-written but unassigned; agent-task fails both axes.
    expect(visible({ createdBy: ["human"], assignee: ["human"] })).toEqual([
      "agent-bullet",
      "human-child",
      "human-task",
      "root",
    ]);
  });

  it("shows nothing when an axis allows no value at all", () => {
    expect(visible({ createdBy: [] })).toEqual([]);
  });
});

describe("matchesFilters", () => {
  it("judges each node on its own values, tasks on both axes", () => {
    const task = node({ id: "t", kind: "task", createdBy: "agent" });
    expect(matchesFilters(task, { createdBy: ["human"] })).toBe(false);
    expect(matchesFilters(task, { createdBy: ["agent"], assignee: ["unassigned"] })).toBe(true);
    expect(matchesFilters(task, { assignee: ["human"] })).toBe(false);
  });
});

describe("narrowedFilters", () => {
  it("is null when nothing narrows, so ui-state.json keeps no filters key", () => {
    expect(narrowedFilters({})).toBe(null);
    expect(narrowedFilters({ createdBy: ["human", "agent"] })).toBe(null);
  });

  it("drops the axes that allow everything", () => {
    expect(narrowedFilters({ createdBy: ["human", "agent"], assignee: ["human"] })).toEqual({ assignee: ["human"] });
  });
});

describe("toggleAxis", () => {
  it("unchecks one value of a previously unset axis", () => {
    expect(toggleAxis(undefined, CREATED_BY_VALUES, "agent")).toEqual(["human"]);
  });

  it("collapses back to undefined once every value is allowed again", () => {
    expect(toggleAxis(["human"], CREATED_BY_VALUES, "agent")).toBe(undefined);
  });

  it("keeps the canonical value order, whatever the toggle order", () => {
    expect(toggleAxis(["unassigned"], ASSIGNEE_VALUES, "human")).toEqual(["human", "unassigned"]);
  });

  it("can empty an axis completely", () => {
    expect(toggleAxis(["human"], CREATED_BY_VALUES, "human")).toEqual([]);
  });
});
