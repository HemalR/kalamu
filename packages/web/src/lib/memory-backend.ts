/**
 * In-memory Backend for the embedded landing-page demo: the same UI runs the
 * same pure @kalamu/core operations the CLI server runs (see
 * packages/cli/src/server.ts), but against a private nodes array — no server,
 * no persistence, resets on reload. Plain TS, no Svelte.
 */
import {
  addNode,
  buildTree,
  deleteNode,
  markDone,
  moveNode,
  preorder,
  reopen,
  serializeJsonl,
  updateNode,
  validateOutline,
  TAG_PATTERN,
  type KalamuMeta,
  type KalamuNode,
} from "@kalamu/core";
import { ApiError, type Backend } from "./api";

export function createMemoryBackend(seed: KalamuNode[]): Backend {
  let nodes: KalamuNode[] = preorder(buildTree(structuredClone(seed)));
  let meta: KalamuMeta = { version: 1 };
  // Deterministic ids, distinct from core's random n_<time><random> ones —
  // the store adopts the returned id, so it must be the node's final id.
  let counter = 0;
  const nextId = (): string => {
    let id: string;
    do id = `n_demo${++counter}`;
    while (nodes.some((n) => n.id === id));
    return id;
  };

  return {
    getNodes: async () => ({ nodes: structuredClone(nodes) }),

    // Whole-outline replace (undo/redo, split/merge, clean). Like the server:
    // validate first, then store canonical pre-order.
    replaceNodes: async (next) => {
      const validation = validateOutline(serializeJsonl(next));
      if (!validation.valid) throw new ApiError(validation.errors[0] ?? "invalid outline", 400);
      nodes = preorder(buildTree(structuredClone(next)));
      return { nodes: structuredClone(nodes) };
    },

    createNode: async (body) => {
      const added = addNode(nodes, {
        parentId: body.parentId ?? undefined,
        kind: body.kind,
        text: body.text,
        priority: body.priority,
        tags: body.tags,
        assignee: body.assignee,
        afterId: body.afterId,
        beforeId: body.beforeId,
      });
      // addNode mints its own id; rename to the demo counter id (the new node
      // has no children yet, so only the node itself needs the swap).
      const node: KalamuNode = { ...added.node, id: nextId() };
      nodes = added.nodes.map((n) => (n.id === added.node.id ? node : n));
      return node;
    },

    patchNode: async (id, body) => {
      const result = updateNode(nodes, id, body);
      nodes = result.nodes;
      return result.node;
    },

    deleteNode: async (id, recursive) => {
      const result = deleteNode(nodes, id, { recursive });
      nodes = result.nodes;
      return { id, deleted: result.deletedCount };
    },

    moveNode: async (id, body) => {
      const result = moveNode(nodes, id, body);
      nodes = result.nodes;
      return result.node;
    },

    markDone: async (id) => {
      const result = markDone(nodes, id);
      nodes = result.nodes;
      return result.node;
    },

    reopen: async (id) => {
      const result = reopen(nodes, id);
      nodes = result.nodes;
      return result.node;
    },

    // hubInstalled true / updateAvailable false: nothing that reads this may
    // ever show install or update chrome in the demo.
    getProject: async () => ({
      name: "demo",
      platform: "browser",
      hubInstalled: true,
      version: "demo",
      latestVersion: null,
      updateAvailable: false,
    }),

    getMeta: async () => ({ ...meta }),

    setTagColor: async (tag, color) => {
      const name = tag.toLowerCase();
      if (!TAG_PATTERN.test(name)) throw new ApiError(`invalid tag name "${name}"`, 400);
      const overrides = { ...meta.tags };
      if (color === null) delete overrides[name];
      else overrides[name] = color;
      meta = { version: meta.version, ...(Object.keys(overrides).length > 0 ? { tags: overrides } : {}) };
      return { ...meta };
    },

    getUiState: async () => ({ collapsed: [] }),
    putUiState: async (state) => state,

    // Pasted images render from `${apiBase}/assets/*` (segments.ts), which
    // doesn't exist on the landing site — refuse with a friendly toast
    // (the store's queue surfaces the message) instead of a broken image.
    uploadAsset: async () => {
      throw new ApiError("image paste isn't available in this demo", 400);
    },

    // No server to lose: the store stays connected forever.
    subscribe: () => () => {},
  };
}
