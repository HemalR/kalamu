import type { KalamuNode } from "@kalamu/core";
import { describe, expect, it, vi } from "vitest";
import { setBackend } from "../src/lib/api";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { OutlineStore } from "../src/lib/outline.svelte";

function node(overrides: Partial<KalamuNode> & { id: string }): KalamuNode {
  return { parentId: null, kind: "bullet", text: "", createdAt: "2026-07-09T00:00:00.000Z", doneAt: null, ...overrides };
}

function storeWith(nodes: KalamuNode[]): OutlineStore {
  setBackend(createMemoryBackend(nodes));
  const store = new OutlineStore();
  store.nodes = nodes;
  vi.spyOn(store, "focus").mockResolvedValue();
  return store;
}

describe("numbered lists in the store", () => {
  it("Enter at the end continues the list", () => {
    const store = storeWith([node({ id: "a", text: "1. one" }), node({ id: "b", text: "2. two" })]);
    store.createAfter("a");
    expect(store.nodes.map((n) => n.text)).toEqual(["1. one", "2.", "3. two"]);
  });

  it("splitting a numbered item numbers the continuation", () => {
    const store = storeWith([node({ id: "a", text: "1. one two" }), node({ id: "b", text: "2. three" })]);
    store.splitNode("a", "1. one", "1. two");
    expect(store.nodes.map((n) => n.text)).toEqual(["1. one", "2. two", "3. three"]);
  });
});
