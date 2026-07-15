/**
 * All outline state and mutations, shared by every component.
 *
 * Mutations are applied optimistically with the same pure operations the
 * server uses (@kalamu/core), then persisted through the API on a serialized
 * queue — so the UI feels instant while the JSONL file stays canonical.
 *
 * Created nodes keep their locally generated id for the whole session (the
 * server's id is aliased via toServer/toLocal); this keeps `{#each}` keys and
 * therefore contenteditable elements stable while a POST is in flight.
 */
import {
  addNode,
  appendTags,
  buildTree,
  cleanDone,
  deleteNode,
  deriveTags,
  markDone,
  moveNode,
  OperationError,
  reopen,
  stripTags,
  subtreeIds,
  updateNode,
  type Assignee,
  type KalamuMeta,
  type KalamuNode,
  type ParsedTokens,
} from "@kalamu/core";
import { tick } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { api, ApiError, type Priority } from "./api";
import type { CaretPosition } from "./caret";
import { commitPatch, tokenPatch, type CommitPatch } from "./commit";
import { discussionPrompt, serializeSubtree, writeClipboard } from "./copy";
import { filterVisibleIds } from "./filter";

const UNDO_LIMIT = 100;
const UI_STATE_DEBOUNCE_MS = 400;
const TOAST_MS = 4000;

/** Where to put the caret when a node takes focus. */
export type FocusTarget = CaretPosition | { x: number; line: "first" | "last" };

/**
 * Registered by each OutlineNode. The node owns the editing/display swap, so
 * focusing must go through it: it mounts the editable, then places the caret.
 */
export interface NodeHandle {
  focusAt: (target: FocusTarget) => void;
}

export class OutlineStore {
  nodes = $state.raw<KalamuNode[]>([]);
  meta = $state.raw<KalamuMeta>({ version: 1 });
  collapsed = new SvelteSet<string>();
  loaded = $state(false);
  loadError = $state<string | null>(null);
  toast = $state<string | null>(null);

  /**
   * Server reachability. While false, every mutation refuses (mutate/restore/
   * enqueue callers early-return) and the UI drops into read-only mode — an
   * optimistic edit the server never sees would vanish on reload.
   */
  connected = $state(true);

  /** Active tag filter — session-only view state, never persisted (SPEC "Tags"). */
  filterTag = $state<string | null>(null);
  /** Nodes created while a filter is active stay visible until it changes. */
  private filterExtras = new SvelteSet<string>();

  tree = $derived(buildTree(this.nodes));
  roots = $derived(this.tree.children.get(null) ?? []);
  private filterMatches = $derived.by(() =>
    this.filterTag === null ? null : filterVisibleIds(this.tree, this.filterTag),
  );

  /** False only when a tag filter hides the node. Hidden nodes hide their subtrees. */
  isVisible(id: string): boolean {
    return this.filterMatches === null || this.filterMatches.has(id) || this.filterExtras.has(id);
  }

  /** The children of `id` that the active filter leaves visible (render order). */
  visibleChildren(id: string | null): KalamuNode[] {
    const children = this.tree.children.get(id) ?? [];
    return this.filterMatches === null ? children : children.filter((child) => this.isVisible(child.id));
  }

  setFilter(tag: string | null): void {
    this.filterTag = tag;
    this.filterExtras.clear();
  }

  /** Pre-order ids of nodes currently rendered (collapse- and filter-aware); drives focus movement. */
  visibleIds = $derived.by(() => {
    const out: string[] = [];
    const walk = (parentId: string | null): void => {
      for (const child of this.visibleChildren(parentId)) {
        out.push(child.id);
        if (!this.collapsed.has(child.id)) walk(child.id);
      }
    };
    walk(null);
    return out;
  });

  /** Focus handles by node id; OutlineNode registers via an attachment. */
  readonly handles = new Map<string, NodeHandle>();

  private undoStack: KalamuNode[][] = [];
  private redoStack: KalamuNode[][] = [];
  private toServer = new Map<string, string>();
  private toLocal = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private needsRefetch = false;
  private opVersion = 0;
  private uiStateTimer: ReturnType<typeof setTimeout> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private stopEvents: (() => void) | undefined;
  private eventsPaused = false;

  async init(): Promise<void> {
    try {
      const [nodesResult, meta, uiState] = await Promise.all([api.getNodes(), api.getMeta(), api.getUiState()]);
      this.nodes = nodesResult.nodes;
      this.meta = meta;
      for (const id of uiState.collapsed) this.collapsed.add(id);
      this.loaded = true;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : "unknown error";
      return;
    }
    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    // pagehide can run while the initial requests above are still in flight.
    // In that case init may finish, but the obsolete page must not open SSE.
    if (this.eventsPaused || this.stopEvents !== undefined) return;
    this.stopEvents = api.subscribe({
      onConnected: () => this.setConnected(true),
      onDisconnected: () => this.setConnected(false),
      onOutlineChanged: () => void this.refetchNodes(),
      onMetaChanged: () => void this.refetchMeta(),
    });
  }

  /** Close SSE before full-page hub navigation (or entry into the bfcache). */
  pauseEvents(): void {
    this.eventsPaused = true;
    this.stopEvents?.();
    this.stopEvents = undefined;
  }

  /** Restore SSE when a bfcache-preserved page becomes active again. */
  resumeEvents(): void {
    const wasPaused = this.eventsPaused;
    this.eventsPaused = false;
    if (!this.loaded) return;
    this.subscribeToEvents();
    if (wasPaused) {
      // Changes made while this document was hidden were not pushed to it.
      void this.refetchNodes();
      void this.refetchMeta();
    }
  }

  private setConnected(value: boolean): void {
    if (value === this.connected) return;
    this.connected = value;
    if (value) {
      this.showToast("Reconnected");
      // Anything that changed while the SSE stream was down went unannounced.
      void this.refetchNodes();
      void this.refetchMeta();
    }
  }

  // ---- persistence plumbing -------------------------------------------------

  private enqueue(persist: () => Promise<unknown>): void {
    this.pending++;
    this.queue = this.queue
      .then(persist)
      .catch((err: unknown) => {
        // A network-level failure means disconnected; the banner says so.
        if (err instanceof ApiError && err.status === 0) this.setConnected(false);
        else this.showToast(err instanceof Error ? err.message : "failed to save");
        this.needsRefetch = true;
      })
      .finally(() => {
        this.pending--;
        if (this.pending === 0 && this.needsRefetch) {
          this.needsRefetch = false;
          void this.refetchNodes();
        }
      });
  }

  /** Reload from disk (SSE outline-changed, or recovery after a failed write). */
  async refetchNodes(): Promise<void> {
    if (this.pending > 0) {
      // Local ops are still persisting; refetch once the queue drains.
      this.needsRefetch = true;
      return;
    }
    const version = this.opVersion;
    try {
      const { nodes } = await api.getNodes();
      if (this.opVersion === version && this.pending === 0) {
        this.nodes = this.localize(nodes);
      } else {
        this.needsRefetch = true;
      }
    } catch {
      // Server briefly unreachable; the next SSE event or op retries.
    }
  }

  private async refetchMeta(): Promise<void> {
    try {
      this.meta = await api.getMeta();
    } catch {
      // Non-critical; tag colours fall back to hash-derived values.
    }
  }

  /**
   * Optimistically apply `local` (a pure core operation) and queue `persist`.
   * Returns false when the operation is a no-op/refused (e.g. invalid move).
   */
  private mutate(local: (nodes: readonly KalamuNode[]) => KalamuNode[], persist: () => Promise<unknown>): boolean {
    if (!this.connected) return false; // read-only while the server is unreachable
    let next: KalamuNode[];
    try {
      next = local(this.nodes);
    } catch (err) {
      if (err instanceof OperationError) return false;
      throw err;
    }
    this.undoStack.push(this.nodes);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.opVersion++;
    this.nodes = next;
    this.enqueue(persist);
    return true;
  }

  // ---- session-local id aliasing --------------------------------------------

  /**
   * The id as the server/CLI knows it — created nodes keep a local alias for
   * the session. Public for the palette's copyable CLI commands.
   */
  serverId(id: string): string {
    return this.toServer.get(id) ?? id;
  }

  private adopt(localId: string, serverId: string): void {
    if (localId === serverId) return;
    this.toServer.set(localId, serverId);
    this.toLocal.set(serverId, localId);
  }

  private localize(nodes: KalamuNode[]): KalamuNode[] {
    return nodes.map((n) => {
      const id = this.toLocal.get(n.id) ?? n.id;
      const parentId = n.parentId === null ? null : (this.toLocal.get(n.parentId) ?? n.parentId);
      return id === n.id && parentId === n.parentId ? n : { ...n, id, parentId };
    });
  }

  private serverize(nodes: KalamuNode[]): KalamuNode[] {
    return nodes.map((n) => {
      const id = this.serverId(n.id);
      const parentId = n.parentId === null ? null : this.serverId(n.parentId);
      return id === n.id && parentId === n.parentId ? n : { ...n, id, parentId };
    });
  }

  // ---- undo / redo -----------------------------------------------------------

  undo(): void {
    this.restore(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.restore(this.redoStack, this.undoStack);
  }

  private restore(from: KalamuNode[][], to: KalamuNode[][]): void {
    if (!this.connected) return;
    const target = from.pop();
    if (!target) return;
    to.push(this.nodes);
    this.opVersion++;
    this.nodes = target;
    this.enqueue(() => api.replaceNodes(this.serverize(target)));
  }

  // ---- node operations -------------------------------------------------------

  /** New empty sibling below `id`, inheriting its kind; focuses it. */
  createAfter(id: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    let localId = "";
    const applied = this.mutate(
      (nodes) => {
        const result = addNode(nodes, { parentId: node.parentId ?? undefined, kind: node.kind, text: "", afterId: id });
        localId = result.node.id;
        return result.nodes;
      },
      async () => {
        const created = await api.createNode({
          parentId: node.parentId === null ? null : this.serverId(node.parentId),
          kind: node.kind,
          text: "",
          afterId: this.serverId(id),
        });
        this.adopt(localId, created.id);
      },
    );
    if (applied) this.revealNewNode(localId);
  }

  /**
   * Enter mid-text: `before` stays in the node, a new sibling right after it
   * takes `after` (inheriting only the kind) plus ALL of the node's children —
   * the new node is the continuation. One mutate call, so one undo step.
   */
  splitNode(id: string, before: string, after: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    // mutate runs `local` synchronously, so the tree snapshot is still current.
    const childIds = (this.tree.children.get(id) ?? []).map((child) => child.id);
    let localId = "";
    let next: KalamuNode[] = [];
    const applied = this.mutate(
      (nodes) => {
        const patch = commitPatch(node, before);
        const trimmed = patch ? updateNode(nodes, id, patch).nodes : nodes;
        const added = addNode(trimmed, {
          parentId: node.parentId ?? undefined,
          kind: node.kind,
          text: after,
          afterId: id,
        });
        localId = added.node.id;
        next = added.nodes;
        // Sequential appends preserve the children's order under the new node.
        for (const childId of childIds) next = moveNode(next, childId, { parentId: localId }).nodes;
        return next;
      },
      // Whole-outline replace (like undo/clean): the server keeps client ids,
      // so the new node needs no adoption.
      () => api.replaceNodes(this.serverize(next)),
    );
    if (applied) this.revealNewNode(localId);
  }

  /**
   * Backspace at the start of a non-empty node: fold it into the node
   * rendered directly above (the previous visible id) — the inverse of
   * splitNode. The merged text is target text + draft with no separator, the
   * node's children become the target's FIRST children (order preserved, so
   * a first child merging into its parent keeps document order), and the
   * node itself is deleted. One mutate call, so one undo step.
   */
  mergeIntoPrevious(id: string, draft: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const order = this.visibleIds;
    const target = this.tree.byId.get(order[order.indexOf(id) - 1] ?? "");
    if (!target) return; // first visible node: nothing above to merge into
    // mutate runs `local` synchronously, so the tree snapshot is still current.
    const childIds = (this.tree.children.get(id) ?? []).map((child) => child.id);
    // May be the merging node itself (a first child folding into its parent);
    // it still anchors the inserts and is deleted afterwards.
    const anchorId = (this.tree.children.get(target.id) ?? [])[0]?.id;
    const junction = target.text.length;
    let next: KalamuNode[] = [];
    const applied = this.mutate(
      (nodes) => {
        const patch = commitPatch(target, target.text + draft);
        let merged: readonly KalamuNode[] = patch ? updateNode(nodes, target.id, patch).nodes : nodes;
        // Sequential inserts before a fixed anchor preserve the children's order.
        for (const childId of childIds) {
          merged = moveNode(merged, childId, { parentId: target.id, ...(anchorId === undefined ? {} : { beforeId: anchorId }) }).nodes;
        }
        next = deleteNode(merged, id).nodes;
        return next;
      },
      // Whole-outline replace (like splitNode): the server keeps client ids.
      () => api.replaceNodes(this.serverize(next)),
    );
    if (!applied) return;
    // Expand the target so adopted children don't vanish into a fold.
    if (childIds.length > 0 && this.collapsed.delete(target.id)) this.persistUiStateSoon();
    void this.focus(target.id, junction);
  }

  /** New empty bullet appended at the top level; focuses it. */
  createRoot(): void {
    let localId = "";
    const applied = this.mutate(
      (nodes) => {
        const result = addNode(nodes, { text: "" });
        localId = result.node.id;
        return result.nodes;
      },
      async () => {
        const created = await api.createNode({ text: "" });
        this.adopt(localId, created.id);
      },
    );
    if (applied) this.revealNewNode(localId);
  }

  /** Fresh nodes must not vanish mid-typing under an active tag filter. */
  private revealNewNode(id: string): void {
    if (this.filterTag !== null) this.filterExtras.add(id);
    void this.focus(id, "start");
  }

  /**
   * Commit-time token parsing (SPEC key decision 9): extract p1–p5 / @human/@agent
   * from the typed text; #tags stay in the text verbatim (key decision 7).
   * The delta rules — including "a typed priority token overrides the stored
   * priority" — live in commit.ts (pure, unit-tested).
   */
  commitText(id: string, raw: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const patch = commitPatch(node, raw);
    if (patch) this.applyPatch(id, patch);
  }

  /** Parse-on-space: apply a just-typed pN/@human/@agent token; the editor handles the text. */
  applyToken(id: string, parsed: ParsedTokens): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const patch = tokenPatch(node, parsed);
    if (Object.keys(patch).length > 0) this.applyPatch(id, patch);
  }

  private applyPatch(id: string, patch: CommitPatch): void {
    this.mutate(
      (nodes) => updateNode(nodes, id, patch).nodes,
      () => api.patchNode(this.serverId(id), patch),
    );
  }

  cycleKind(id: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const kind = node.kind === "bullet" ? "task" : node.kind === "task" ? "discussion" : "bullet";
    this.mutate(
      (nodes) => updateNode(nodes, id, { kind }).nodes,
      () => api.patchNode(this.serverId(id), { kind }),
    );
  }

  /** Works on bullets too — done on a bullet is visual only (strikethrough). */
  toggleDone(id: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const [operation, call] = node.doneAt === null ? [markDone, api.markDone] : [reopen, api.reopen];
    this.mutate(
      (nodes) => operation(nodes, id).nodes,
      () => call(this.serverId(id)),
    );
  }

  /** Tasks only; null clears back to unassigned. */
  setAssignee(id: string, assignee: Assignee | null): void {
    const node = this.tree.byId.get(id);
    if (!node || node.kind !== "task") return;
    this.mutate(
      (nodes) => updateNode(nodes, id, { assignee }).nodes,
      () => api.patchNode(this.serverId(id), { assignee }),
    );
  }

  /** Work items only — priority on a discussion never converts it (SPEC key decision 12). */
  setPriority(id: string, priority: Priority): void {
    const node = this.tree.byId.get(id);
    if (!node || node.kind === "bullet") return;
    const value = priority === 3 ? "default" : priority;
    this.mutate(
      (nodes) => updateNode(nodes, id, { priority: value }).nodes,
      () => api.patchNode(this.serverId(id), { priority: value }),
    );
  }

  /** Tab: become the last child of the previous sibling. */
  indent(id: string): boolean {
    const node = this.tree.byId.get(id);
    if (!node) return false;
    const siblings = this.tree.children.get(node.parentId) ?? [];
    const target = siblings[siblings.findIndex((s) => s.id === id) - 1];
    if (!target) return false;
    const applied = this.mutate(
      (nodes) => moveNode(nodes, id, { parentId: target.id }).nodes,
      () => api.moveNode(this.serverId(id), { parentId: this.serverId(target.id) }),
    );
    // Expand the new parent so the node doesn't vanish into a fold.
    if (applied && this.collapsed.delete(target.id)) this.persistUiStateSoon();
    return applied;
  }

  /** Shift+Tab: become the sibling immediately after the current parent. */
  outdent(id: string): boolean {
    const node = this.tree.byId.get(id);
    if (!node || node.parentId === null) return false;
    const parent = this.tree.byId.get(node.parentId);
    if (!parent) return false;
    return this.mutate(
      (nodes) => moveNode(nodes, id, { parentId: parent.parentId, afterId: parent.id }).nodes,
      () =>
        api.moveNode(this.serverId(id), {
          parentId: parent.parentId === null ? null : this.serverId(parent.parentId),
          afterId: this.serverId(parent.id),
        }),
    );
  }

  /** Cmd/Ctrl+ArrowUp/Down: swap with the previous/next sibling. */
  moveBySibling(id: string, delta: -1 | 1): boolean {
    const node = this.tree.byId.get(id);
    if (!node) return false;
    const siblings = this.tree.children.get(node.parentId) ?? [];
    const target = siblings[siblings.findIndex((s) => s.id === id) + delta];
    if (!target) return false;
    return this.mutate(
      (nodes) => moveNode(nodes, id, delta === -1 ? { beforeId: target.id } : { afterId: target.id }).nodes,
      () =>
        api.moveNode(
          this.serverId(id),
          delta === -1 ? { beforeId: this.serverId(target.id) } : { afterId: this.serverId(target.id) },
        ),
    );
  }

  /** Backspace on an empty node: delete it (leaves only) and focus a neighbour. */
  deleteEmpty(id: string): void {
    if ((this.tree.children.get(id) ?? []).length > 0) return; // subtree delete is explicit (Cmd+Shift+Backspace)
    this.deleteAndRefocus(id, false);
  }

  deleteSubtree(id: string): void {
    this.deleteAndRefocus(id, true);
  }

  /** Mod+C with nothing selected: copy the node and all descendants as text. */
  copySubtree(id: string): void {
    if (!this.tree.byId.has(id)) return;
    const { text, count } = serializeSubtree(this.tree, id);
    writeClipboard(text).then(
      () => this.showToast(`Copied ${count} item${count === 1 ? "" : "s"}`),
      () => this.showToast("could not access the clipboard"),
    );
  }

  /** A discussion's "Copy prompt": topic + subtree + a do-not-code instruction, ready for an agent. */
  copyDiscussionPrompt(id: string): void {
    const prompt = discussionPrompt(this.tree, id, this.serverId(id));
    if (prompt === null) return;
    writeClipboard(prompt).then(
      () => this.showToast("Discussion prompt copied — paste it into your agent."),
      () => this.showToast("could not access the clipboard"),
    );
  }

  private deleteAndRefocus(id: string, recursive: boolean): void {
    if (!this.tree.byId.has(id)) return;
    const fallback = this.neighborOf(id);
    const applied = this.mutate(
      (nodes) => deleteNode(nodes, id, { recursive }).nodes,
      () => api.deleteNode(this.serverId(id), recursive),
    );
    if (applied && fallback !== null) void this.focus(fallback, "end");
  }

  /** Nearest visible node outside `id`'s subtree — where focus lands after deletion. */
  private neighborOf(id: string): string | null {
    const order = this.visibleIds;
    const index = order.indexOf(id);
    if (index > 0) return order[index - 1] ?? null;
    const doomed = subtreeIds(this.tree, id);
    for (let i = index + 1; i < order.length; i++) {
      const candidate = order[i];
      if (candidate !== undefined && !doomed.has(candidate)) return candidate;
    }
    return null;
  }

  /** `kalamu clean` in the UI: delete every done task with its subtree, plus done bullets, done discussions, and blank nodes — undoable. */
  clean(): void {
    if (!this.connected) return;
    const result = cleanDone(this.nodes);
    if (result.removed.length === 0) {
      this.showToast("Nothing to clean.");
      return;
    }
    this.mutate(
      // mutate runs the callback synchronously, so the guard's result is still current.
      () => result.nodes,
      // Whole-outline replace, exactly like undo/redo's restore.
      () => api.replaceNodes(this.serverize(result.nodes)),
    );
    const { removed, doneTasks, doneBullets, doneDiscussions, blankNodes } = result;
    // Same wording as the CLI's clean output (SPEC), with proper plurals.
    const detail = [
      doneTasks > 0 ? `${doneTasks} done task${doneTasks === 1 ? "" : "s"}` : "",
      doneBullets > 0 ? `${doneBullets} done bullet${doneBullets === 1 ? "" : "s"}` : "",
      doneDiscussions > 0 ? `${doneDiscussions} done discussion${doneDiscussions === 1 ? "" : "s"}` : "",
      blankNodes > 0 ? `${blankNodes} blank node${blankNodes === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    this.showToast(`Deleted ${removed.length} node${removed.length === 1 ? "" : "s"} (${detail})`);
  }

  // ---- collapse state (view state, never document content) -------------------

  toggleCollapse(id: string): void {
    if (!this.collapsed.delete(id)) {
      if ((this.tree.children.get(id) ?? []).length === 0) return; // nothing to fold
      this.collapsed.add(id);
    }
    this.persistUiStateSoon();
  }

  private persistUiStateSoon(): void {
    clearTimeout(this.uiStateTimer);
    this.uiStateTimer = setTimeout(() => {
      const collapsed = [...this.collapsed]
        .filter((id) => this.tree.byId.has(id)) // prune deleted ids opportunistically
        .map((id) => this.serverId(id));
      api.putUiState({ collapsed }).catch(() => {
        // View state only; losing a fold is harmless.
      });
    }, UI_STATE_DEBOUNCE_MS);
  }

  // ---- tags -------------------------------------------------------------------

  /** Every tag in the outline (tags live inline in text — SPEC key decision 7). */
  allTags = $derived.by(() => {
    const tags = new Set<string>();
    for (const node of this.nodes) for (const tag of deriveTags(node.text)) tags.add(tag);
    return [...tags].sort();
  });

  /** Add or remove the #tag token in the node's text (there is no tags field). */
  toggleTag(id: string, tag: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const next = deriveTags(node.text).includes(tag) ? stripTags(node.text, [tag]) : appendTags(node.text, [tag]);
    this.commitText(id, next);
  }

  setTagColor(tag: string, color: string | null): void {
    if (!this.connected) return;
    const overrides = { ...this.meta.tags };
    if (color === null) delete overrides[tag];
    else overrides[tag] = color;
    this.meta = { ...this.meta, tags: Object.keys(overrides).length > 0 ? overrides : undefined };
    this.enqueue(() => api.setTagColor(tag, color));
  }

  // ---- focus ------------------------------------------------------------------

  /**
   * The node the command palette acts on. Set when an editable gains focus and
   * never cleared on blur — the palette steals focus when it opens and must
   * still know its target. May point at a since-deleted node; consumers must
   * check tree.byId.
   */
  lastFocusedId = $state<string | null>(null);

  async focus(id: string, caret: CaretPosition): Promise<void> {
    await tick();
    const handle = this.handles.get(id);
    if (handle) {
      handle.focusAt(caret);
      return;
    }
    // Moved subtrees remount a frame later; retry once.
    requestAnimationFrame(() => {
      this.handles.get(id)?.focusAt(caret);
    });
  }

  /**
   * Remembered screen column for consecutive ArrowUp/Down presses; any other
   * key or a pointer interaction resets it (see OutlineNode).
   */
  goalColumn: number | null = null;

  /**
   * ArrowUp/ArrowDown between visible nodes, placing the caret at screen
   * column `x` — the last line when entering from below, first from above.
   */
  focusSiblingAtColumn(id: string, delta: -1 | 1, x: number): boolean {
    const order = this.visibleIds;
    const target = order[order.indexOf(id) + delta];
    if (target === undefined) return false;
    const handle = this.handles.get(target);
    if (!handle) return false;
    handle.focusAt({ x, line: delta === 1 ? "first" : "last" });
    return true;
  }

  /** Click on the blank space under the outline. */
  focusTail(): void {
    const last = this.visibleIds.at(-1);
    if (last === undefined) this.createRoot();
    else void this.focus(last, "end");
  }

  // ---- toast --------------------------------------------------------------------

  showToast(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
    }, TOAST_MS);
  }
}
