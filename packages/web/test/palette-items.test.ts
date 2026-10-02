import type { KalamuNode } from "@kalamu/core";
import { describe, expect, it, vi } from "vitest";
import { setBackend } from "../src/lib/api";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { OutlineStore } from "../src/lib/outline.svelte";
import { LEVELS, type Level, type PaletteContext } from "../src/lib/palette-items";

function node(overrides: Partial<KalamuNode> & { id: string }): KalamuNode {
  return { parentId: null, kind: "task", text: "", createdAt: "2026-07-09T00:00:00.000Z", doneAt: null, ...overrides };
}

const NODES = [
  node({ id: "a", text: "Ship it", priority: 1, assignee: "human", blockedBy: ["b", "c"] }),
  node({ id: "b", text: "Design" }),
  node({ id: "c", text: "Review", doneAt: "2026-08-01T00:00:00.000Z" }),
  node({ id: "d", kind: "discussion", text: "Naming" }),
];

/** A context over NODES, every exit spied; `target` picks the focused node by id. */
function context(target?: string): PaletteContext {
  setBackend(createMemoryBackend(NODES));
  const store = new OutlineStore();
  store.nodes = NODES;
  return {
    store,
    target: target === undefined ? undefined : store.tree.byId.get(target),
    projects: [],
    activeSlug: "",
    theme: { mode: "light", toggle: vi.fn() },
    enter: vi.fn(),
    close: vi.fn(),
    dismiss: vi.fn(),
    copyCommand: vi.fn(),
    navigate: vi.fn(),
    show: { shortcuts: vi.fn(), cli: vi.fn(), find: vi.fn() },
  };
}

const row = (ctx: PaletteContext, level: Level, id: string) => LEVELS[level](ctx).find((item) => item.id === id);

describe("root level", () => {
  it("disables node actions without a target but keeps document-wide ones", () => {
    const ctx = context();
    expect(row(ctx, "root", "done")?.disabled).toBe(true);
    expect(row(ctx, "root", "priority")?.disabled).toBe(true);
    expect(row(ctx, "root", "find")?.disabled).toBeUndefined();
    expect(row(ctx, "root", "clean")?.disabled).toBeUndefined();
  });

  it("never offers Assign on a discussion", () => {
    expect(row(context("d"), "root", "assign")?.disabled).toBe(true);
    expect(row(context("b"), "root", "assign")?.disabled).toBe(false);
  });

  it("numbers hub projects first and navigates to any but the active one", () => {
    const ctx = { ...context(), activeSlug: "one" };
    ctx.projects = [
      { slug: "one", name: "One", color: "#111111" },
      { slug: "two", name: "Two", color: "#222222" },
    ];
    const items = LEVELS.root(ctx);
    expect(items.slice(0, 2).map((item) => item.key)).toEqual(["1", "2"]);
    items[1]?.run();
    expect(ctx.navigate).toHaveBeenCalledWith("/p/two");
    items[0]?.run();
    expect(ctx.close).toHaveBeenCalledOnce();
  });
});

describe("sublevels", () => {
  it("ticks the target's current priority and assignee", () => {
    const ctx = context("a");
    expect(LEVELS.priority(ctx).filter((item) => item.checked).map((item) => item.id)).toEqual(["p1"]);
    expect(LEVELS.assign(ctx).map((item) => [item.key, item.checked])).toEqual([
      ["a", false],
      ["h", true],
      ["u", false],
    ]);
  });

  it("clearing the assignee closes with the caret restored", () => {
    const ctx = context("a");
    const setAssignee = vi.spyOn(ctx.store, "setAssignee").mockImplementation(() => {});
    row(ctx, "assign", "assign-none")?.run();
    expect(setAssignee).toHaveBeenCalledWith("a", null);
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it("offers Remove all on `a` once there is more than one blocker, and marks done ones", () => {
    const items = LEVELS.unblock(context("a"));
    expect(items.map((item) => [item.key, item.label])).toEqual([
      ["1", expect.stringContaining("Design")],
      ["2", expect.stringMatching(/Review — done$/)],
      ["a", "Remove all blockers"],
    ]);
  });

  it("removes a lone blocker directly instead of opening the picker", () => {
    const ctx = context("a");
    ctx.target = { ...NODES[0]!, blockedBy: ["b"] };
    const removeBlocker = vi.spyOn(ctx.store, "removeBlocker").mockImplementation(() => {});
    const remove = row(ctx, "blocking", "remove-block");
    expect(remove?.label).toBe("Remove block");
    remove?.run();
    expect(removeBlocker).toHaveBeenCalledWith("a", "b");
    expect(ctx.enter).not.toHaveBeenCalled();
  });

  it("greys the moves that would be inert and stays open for repeated ones", () => {
    const ctx = context("a"); // first of four top-level siblings
    expect(LEVELS.move(ctx).map((item) => [item.id, item.disabled])).toEqual([
      ["move-up", true],
      ["move-down", false],
      ["indent", true],
      ["outdent", true],
    ]);
    row(ctx, "move", "move-down")?.run();
    expect(ctx.store.nodes.map((n) => n.id)).toEqual(["b", "a", "c", "d"]);
    expect(ctx.close).not.toHaveBeenCalled();
  });
});
