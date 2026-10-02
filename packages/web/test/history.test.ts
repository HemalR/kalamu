import type { KalamuNode } from "@kalamu/core";
import { describe, expect, it, vi } from "vitest";
import { setBackend, type Backend } from "../src/lib/api";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { OutlineStore } from "../src/lib/outline.svelte";

function node(id: string, text: string): KalamuNode {
  return { id, parentId: null, kind: "task", text, createdAt: "2026-07-09T00:00:00.000Z", doneAt: null };
}

/** Let the store's write queue (and any refetch it schedules) drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A loaded store over a memory backend; calling the backend directly plays an agent's CLI write. */
async function setup(): Promise<{ store: OutlineStore; backend: Backend }> {
  const backend = createMemoryBackend([node("a", "Ship it"), node("b", "Review")]);
  setBackend(backend);
  const store = new OutlineStore();
  vi.spyOn(store, "focus").mockResolvedValue(); // no DOM to put a caret in
  await store.init();
  return { store, backend };
}

describe("undo never reverts another writer's change", () => {
  it("refuses a stale undo, reloads, and clears both stacks", async () => {
    const { store, backend } = await setup();
    store.toggleDone("a");
    await settle();
    await backend.createNode({ text: "Added by an agent" });

    store.undo();
    await settle();
    await settle();

    expect(store.nodes.map((n) => n.text)).toContain("Added by an agent");
    expect(store.nodes.find((n) => n.id === "a")?.doneAt).not.toBeNull();
    expect([store.canUndo, store.canRedo]).toEqual([false, false]);
    expect(store.toast?.message).toMatch(/changed elsewhere/);
  });

  it("clears history when a refetch brings in an outside change, but not for its own echo", async () => {
    const { store, backend } = await setup();
    store.toggleDone("a");
    await settle();

    await store.refetchNodes(); // the SSE echo of our own write
    expect(store.canUndo).toBe(true);

    await backend.patchNode("b", { text: "Reviewed by an agent" });
    await store.refetchNodes();
    expect(store.canUndo).toBe(false);
    store.undo();
    expect(store.toast?.message).toMatch(/Nothing to undo/);
  });

  it("does not adopt the version of a write that landed on top of an unseen outside write", async () => {
    const { store, backend } = await setup();
    await backend.createNode({ text: "Added by an agent" }); // no refetch has shown it yet
    store.toggleDone("a");
    store.undo(); // queued before any refetch could clear history
    await settle();
    await settle();

    expect((await backend.getNodes()).nodes.map((n) => n.text)).toContain("Added by an agent");
    expect(store.toast?.message).toMatch(/changed elsewhere/);
  });

  it("chains its own queued writes: an undo right after an edit is not a conflict", async () => {
    const { store, backend } = await setup();
    store.toggleDone("a");
    store.undo(); // queued behind the done, so it must send the version the done produced
    await settle();

    expect((await backend.getNodes()).nodes.find((n) => n.id === "a")?.doneAt).toBeNull();
    expect(store.toast).toBeNull();
    expect(store.canRedo).toBe(true);
  });
});

describe("toast Undo", () => {
  it("undoes the delete it reports, and goes inert once another edit lands on top", async () => {
    const { store } = await setup();
    store.deleteSubtree("a");
    const undo = store.toast?.action;
    expect(store.toast?.message).toBe("Deleted 1 item");

    undo?.run();
    expect(store.nodes.map((n) => n.id)).toEqual(["a", "b"]);

    store.deleteSubtree("b");
    const stale = store.toast?.action;
    store.toggleDone("a");
    stale?.run();
    expect(store.nodes.map((n) => n.id)).toEqual(["a"]);
  });
});
