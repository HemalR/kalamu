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

const DONE = "2026-08-09T10:00:00.000Z";

/**
 * root > mid > target, plus a second branch — the shape a blocker jump has to
 * cope with, since blockers cross the tree freely (SPEC key decision 16).
 */
function storeWith(nodes: KalamuNode[]): OutlineStore {
  setBackend(createMemoryBackend(nodes));
  const store = new OutlineStore();
  store.nodes = nodes;
  return store;
}

function twoBranches(overrides: { mid?: Partial<KalamuNode>; other?: Partial<KalamuNode> } = {}): OutlineStore {
  return storeWith([
    node({ id: "root" }),
    node({ id: "mid", parentId: "root", ...overrides.mid }),
    node({ id: "target", parentId: "mid", kind: "task", text: "Ship the API" }),
    node({ id: "other", ...overrides.other }),
  ]);
}

describe("revealNode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing for an id that is no longer in the tree", () => {
    const store = twoBranches();
    const focus = vi.spyOn(store, "focus").mockResolvedValue();
    const setZoom = vi.spyOn(store, "setZoom").mockImplementation(() => {});

    store.revealNode("n_gone");

    expect(focus).not.toHaveBeenCalled();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it("focuses the target at the end of its text", () => {
    const store = twoBranches();
    const focus = vi.spyOn(store, "focus").mockResolvedValue();

    store.revealNode("target");

    expect(focus).toHaveBeenCalledWith("target", "end");
  });

  it("drops the zoom entirely when the target sits outside it", () => {
    const store = twoBranches();
    vi.spyOn(store, "focus").mockResolvedValue();
    const setZoom = vi.spyOn(store, "setZoom").mockImplementation(() => {});
    store.zoomId = "other";

    store.revealNode("target");

    expect(setZoom).toHaveBeenCalledWith(null);
  });

  it("leaves the zoom alone when the target is already inside it", () => {
    const store = twoBranches();
    vi.spyOn(store, "focus").mockResolvedValue();
    const setZoom = vi.spyOn(store, "setZoom").mockImplementation(() => {});
    store.zoomId = "root";

    store.revealNode("target");

    expect(setZoom).not.toHaveBeenCalled();
  });

  it("leaves the zoom alone when the target IS the zoom root", () => {
    const store = twoBranches();
    vi.spyOn(store, "focus").mockResolvedValue();
    const setZoom = vi.spyOn(store, "setZoom").mockImplementation(() => {});
    store.zoomId = "target";

    store.revealNode("target");

    expect(setZoom).not.toHaveBeenCalled();
  });

  it("unfolds every ancestor but leaves the target's own fold alone", () => {
    const store = twoBranches();
    vi.spyOn(store, "focus").mockResolvedValue();
    for (const id of ["root", "mid", "target"]) store.collapsed.add(id);

    store.revealNode("target");

    expect([...store.collapsed]).toEqual(["target"]);
  });

  it("reprieves the target and its ancestors from an active tag filter", () => {
    const store = twoBranches({ other: { text: "Elsewhere #x" } });
    vi.spyOn(store, "focus").mockResolvedValue();
    store.setFilter("x");
    expect(store.visibleChildren(null).map(({ id }) => id)).toEqual(["other"]);

    store.revealNode("target");

    expect(store.visibleChildren(null).map(({ id }) => id)).toEqual(["root", "other"]);
    expect(store.visibleChildren("root").map(({ id }) => id)).toEqual(["mid"]);
    expect(store.visibleChildren("mid").map(({ id }) => id)).toEqual(["target"]);
  });

  it("reprieves a done ancestor from hideDone, which would otherwise hide the whole subtree", () => {
    const store = twoBranches({ mid: { doneAt: DONE } });
    vi.spyOn(store, "focus").mockResolvedValue();
    store.hideDone = true;
    expect(store.visibleChildren("root")).toEqual([]);

    store.revealNode("target");

    expect(store.visibleChildren("root").map(({ id }) => id)).toEqual(["mid"]);
    expect(store.visibleChildren("mid").map(({ id }) => id)).toEqual(["target"]);
  });

  it("records no reprieve while nothing is filtering, so a later filter still bites", () => {
    const store = twoBranches({ mid: { doneAt: DONE } });
    vi.spyOn(store, "focus").mockResolvedValue();

    store.revealNode("target");
    store.hideDone = true;

    expect(store.visibleChildren("root")).toEqual([]);
  });

  it("ends the reprieve when the reader changes what they are filtering by", () => {
    const store = twoBranches({ mid: { doneAt: DONE } });
    vi.spyOn(store, "focus").mockResolvedValue();
    store.hideDone = true;
    store.revealNode("target");

    store.toggleHideDone();
    store.toggleHideDone();

    expect(store.visibleChildren("root")).toEqual([]);
  });
});
