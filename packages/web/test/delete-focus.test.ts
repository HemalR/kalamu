import type { KalamuNode } from "@kalamu/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setBackend } from "../src/lib/api";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { OutlineStore } from "../src/lib/outline.svelte";

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

function storeWith(nodes: KalamuNode[]): OutlineStore {
  setBackend(createMemoryBackend(nodes));
  const store = new OutlineStore();
  store.nodes = nodes;
  return store;
}

describe("focus after deletion", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the cursor in place by focusing the visible item below a deleted leaf", () => {
    const store = storeWith([node({ id: "above" }), node({ id: "deleted" }), node({ id: "below" })]);
    const focus = vi.spyOn(store, "focus").mockResolvedValue();

    store.deleteEmpty("deleted");

    expect(store.nodes.map(({ id }) => id)).toEqual(["above", "below"]);
    expect(focus).toHaveBeenCalledWith("below", "end");
  });

  it("skips deleted descendants and focuses the first visible item after a subtree", () => {
    const store = storeWith([
      node({ id: "above" }),
      node({ id: "deleted" }),
      node({ id: "child", parentId: "deleted" }),
      node({ id: "below" }),
    ]);
    const focus = vi.spyOn(store, "focus").mockResolvedValue();

    store.deleteSubtree("deleted");

    expect(store.nodes.map(({ id }) => id)).toEqual(["above", "below"]);
    expect(focus).toHaveBeenCalledWith("below", "end");
  });

  it("falls back to the visible item above when deletion reaches the end", () => {
    const store = storeWith([node({ id: "above" }), node({ id: "deleted" })]);
    const focus = vi.spyOn(store, "focus").mockResolvedValue();

    store.deleteEmpty("deleted");

    expect(focus).toHaveBeenCalledWith("above", "end");
  });

  it("does not try to focus when the only visible item is deleted", () => {
    const store = storeWith([node({ id: "deleted" })]);
    const focus = vi.spyOn(store, "focus").mockResolvedValue();

    store.deleteEmpty("deleted");

    expect(focus).not.toHaveBeenCalled();
  });
});
