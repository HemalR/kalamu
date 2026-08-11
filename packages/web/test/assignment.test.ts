import type { KalamuNode } from "@kalamu/core";
import { describe, expect, it, vi } from "vitest";
import { setBackend } from "../src/lib/api";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { OutlineStore } from "../src/lib/outline.svelte";

function node(kind: KalamuNode["kind"], assignee?: KalamuNode["assignee"]): KalamuNode {
  return {
    id: "n_1",
    parentId: null,
    kind,
    text: "Ship it",
    createdAt: "2026-07-09T00:00:00.000Z",
    doneAt: null,
    ...(assignee === undefined ? {} : { assignee }),
  };
}

function storeWith(initial: KalamuNode): { store: OutlineStore; patchNode: ReturnType<typeof vi.fn> } {
  const backend = createMemoryBackend([initial]);
  const patchNode = vi.fn(backend.patchNode);
  backend.patchNode = patchNode;
  setBackend(backend);
  const store = new OutlineStore();
  store.nodes = [initial];
  return { store, patchNode };
}

describe("OutlineStore assignment", () => {
  it("promotes and assigns a bullet in one patch", async () => {
    const { store, patchNode } = storeWith(node("bullet"));

    store.setAssignee("n_1", "human");

    expect(store.nodes[0]).toMatchObject({ kind: "task", assignee: "human" });
    await vi.waitFor(() => expect(patchNode).toHaveBeenCalledWith("n_1", { kind: "task", assignee: "human" }));
    expect(patchNode).toHaveBeenCalledOnce();
  });

  it("leaves a bullet unchanged when Unassigned is selected", () => {
    const { store, patchNode } = storeWith(node("bullet"));

    store.setAssignee("n_1", null);

    expect(store.nodes[0]?.kind).toBe("bullet");
    expect(patchNode).not.toHaveBeenCalled();
  });

  it("does not assign or convert a discussion", () => {
    const { store, patchNode } = storeWith(node("discussion"));

    store.setAssignee("n_1", "agent");

    expect(store.nodes[0]).toMatchObject({ kind: "discussion" });
    expect(store.nodes[0]?.assignee).toBeUndefined();
    expect(patchNode).not.toHaveBeenCalled();
  });
});
