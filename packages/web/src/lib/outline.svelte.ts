/**
 * All outline state and mutations, shared by every component.
 *
 * The store is one flat object to its consumers (`store.nodes`,
 * `store.compact`, `store.indent(id)`), assembled from three layers so no one
 * file carries the whole thing:
 *
 * - document.svelte.ts — the nodes, the derived tree, and the server plumbing
 *   that keeps them canonical: SSE, the write queue, mutate, undo/redo.
 * - view-state.svelte.ts — filters, collapse, zoom, compact, where attention
 *   is, and the focus registry. Never document content.
 * - this file — the editing vocabulary the components call, expressed with the
 *   same pure operations the server uses (@kalamu/core).
 */
import {
  addBlocker as addBlockerOp,
  addNode,
  appendTags,
  cleanDone,
  deleteNode,
  deriveTags,
  endTask as endTaskOp,
  markDone,
  moveNode,
  removeBlocker as removeBlockerOp,
  reopen,
  startTask as startTaskOp,
  stripTags,
  subtreeIds,
  updateNode,
  type Assignee,
  type KalamuNode,
  type ParsedTokens,
} from "@kalamu/core";
import { api, type Priority } from "./api";
import { commitPatch, tokenPatch, type CommitPatch } from "./commit";
import { rawNodeText, serializeNodeContext, writeClipboard } from "./copy";
import { nextNumberPrefix } from "./numbering";
import { OutlineViewState } from "./view-state.svelte";

export type { FocusTarget, NodeHandle } from "./view-state.svelte";

export class OutlineStore extends OutlineViewState {
  async init(): Promise<void> {
    try {
      const [nodesResult, meta, uiState] = await Promise.all([api.getNodes(), api.getMeta(), api.getUiState()]);
      this.nodes = nodesResult.nodes;
      this.meta = meta;
      for (const id of uiState.collapsed) this.collapsed.add(id);
      this.hideDone = uiState.hideDone ?? false;
      this.compact = uiState.compact ?? false;
      this.filters = uiState.filters ?? {};
      this.loaded = true;
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : "unknown error";
      return;
    }
    this.subscribeToEvents();
  }

  // ---- node operations -------------------------------------------------------

  /** New sibling below `id`, inheriting its kind and continuing an `N.` numbering prefix (else empty); focuses it. */
  createAfter(id: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    if (this.zoomNode?.id === id) {
      // A sibling of the zoom root would be invisible: create a first child
      // inside the zoom instead (no numbering — that's sibling semantics).
      this.createFirstChild(node);
      return;
    }
    const text = nextNumberPrefix(node.text);
    let localId = "";
    const applied = this.mutate(
      (nodes) => {
        const result = addNode(nodes, { parentId: node.parentId ?? undefined, kind: node.kind, text, afterId: id });
        localId = result.node.id;
        return result.nodes;
      },
      async () => {
        const created = await api.createNode({
          parentId: node.parentId === null ? null : this.serverId(node.parentId),
          kind: node.kind,
          text,
          afterId: this.serverId(id),
        });
        this.adopt(localId, created.id);
      },
    );
    if (applied) this.revealNewNode(localId, text === "" ? "start" : "end");
  }

  /** Enter on the zoom root: new empty first child (its kind inherited), focused. */
  private createFirstChild(node: KalamuNode): void {
    const beforeId = (this.tree.children.get(node.id) ?? [])[0]?.id;
    let localId = "";
    const applied = this.mutate(
      (nodes) => {
        const result = addNode(nodes, { parentId: node.id, kind: node.kind, text: "", beforeId });
        localId = result.node.id;
        return result.nodes;
      },
      async () => {
        const created = await api.createNode({
          parentId: this.serverId(node.id),
          kind: node.kind,
          text: "",
          ...(beforeId === undefined ? {} : { beforeId: this.serverId(beforeId) }),
        });
        this.adopt(localId, created.id);
      },
    );
    if (!applied) return;
    // Expand the zoom root so the new child doesn't vanish into a fold.
    this.unfold(node.id);
    this.revealNewNode(localId);
  }

  /**
   * Enter mid-text: `before` stays in the node, a new sibling right after it
   * takes `after` (inheriting only the kind) plus ALL of the node's children —
   * the new node is the continuation. One mutate call, so one undo step.
   */
  splitNode(id: string, before: string, after: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    if (this.zoomNode?.id === id) {
      // Splitting the zoom root: a sibling would be invisible, so the after-
      // text becomes a new FIRST child instead — and the existing children
      // stay put (continuation semantics only make sense between siblings).
      this.splitIntoFirstChild(node, before, after);
      return;
    }
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

  /** splitNode's zoom-root variant. One mutate call, so one undo step. */
  private splitIntoFirstChild(node: KalamuNode, before: string, after: string): void {
    const beforeId = (this.tree.children.get(node.id) ?? [])[0]?.id;
    let localId = "";
    let next: KalamuNode[] = [];
    const applied = this.mutate(
      (nodes) => {
        const patch = commitPatch(node, before);
        const trimmed = patch ? updateNode(nodes, node.id, patch).nodes : nodes;
        const added = addNode(trimmed, { parentId: node.id, kind: node.kind, text: after, beforeId });
        localId = added.node.id;
        next = added.nodes;
        return next;
      },
      // Whole-outline replace (like splitNode): the server keeps client ids.
      () => api.replaceNodes(this.serverize(next)),
    );
    if (!applied) return;
    this.unfold(node.id);
    this.revealNewNode(localId);
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
    if (childIds.length > 0) this.unfold(target.id);
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

  /** Click on the blank space under the outline. */
  focusTail(): void {
    const last = this.visibleIds.at(-1);
    if (last === undefined) this.createRoot();
    else void this.focus(last, "end");
  }

  /**
   * Commit-time token parsing (SPEC key decision 9): extract p1–p3 / @human/@agent
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

  /** Palette "Kind…": the kind named outright, so picking the current one is inert. */
  setKind(id: string, kind: KalamuNode["kind"]): void {
    const node = this.tree.byId.get(id);
    if (!node || node.kind === kind) return;
    this.mutate(
      (nodes) => updateNode(nodes, id, { kind }).nodes,
      () => api.patchNode(this.serverId(id), { kind }),
    );
  }

  cycleKind(id: string): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    this.setKind(id, node.kind === "bullet" ? "task" : node.kind === "task" ? "discussion" : "bullet");
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

  /**
   * Claim a task, so a second agent session does not take work already
   * underway (SPEC key decision 17). The optimistic timestamp is this
   * browser's; the server stamps its own, exactly as toggleDone does.
   */
  startTask(id: string): void {
    this.mutate(
      (nodes) => startTaskOp(nodes, id).nodes,
      () => api.startTask(this.serverId(id)),
      { reportRefusal: true },
    );
  }

  /** Release a claim, returning the task to the queue (not the same as done). */
  endTask(id: string): void {
    this.mutate(
      (nodes) => endTaskOp(nodes, id).nodes,
      () => api.endTask(this.serverId(id)),
      { reportRefusal: true },
    );
  }

  /** Record that a task waits on another node; a cycle is refused with its reason. */
  addBlocker(id: string, blockerId: string): void {
    this.mutate(
      (nodes) => addBlockerOp(nodes, id, blockerId).nodes,
      () => api.addBlocker(this.serverId(id), this.serverId(blockerId)),
      { reportRefusal: true },
    );
  }

  /** Remove one blocker, or every blocker when `blockerId` is omitted. */
  removeBlocker(id: string, blockerId?: string): void {
    this.mutate(
      (nodes) => removeBlockerOp(nodes, id, blockerId).nodes,
      () => api.removeBlocker(this.serverId(id), blockerId === undefined ? undefined : this.serverId(blockerId)),
      { reportRefusal: true },
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

  /**
   * All kinds: core converts a bullet into a task when a real priority (1/3)
   * is set; a discussion keeps its kind (SPEC key decision 12). Priority 2
   * clears back to default.
   */
  setPriority(id: string, priority: Priority): void {
    const node = this.tree.byId.get(id);
    if (!node) return;
    const value = priority === 2 ? "default" : priority;
    this.mutate(
      (nodes) => updateNode(nodes, id, { priority: value }).nodes,
      () => api.patchNode(this.serverId(id), { priority: value }),
    );
  }

  /** Tab: become the last child of the previous sibling. */
  indent(id: string): boolean {
    if (this.zoomNode?.id === id) return false; // its siblings aren't rendered
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
    if (applied) this.unfold(target.id);
    return applied;
  }

  /** Shift+Tab: become the sibling immediately after the current parent. */
  outdent(id: string): boolean {
    const node = this.tree.byId.get(id);
    if (!node || node.parentId === null) return false;
    // Refuse when the move would leave the zoomed subtree.
    if (this.zoomNode !== null && (id === this.zoomNode.id || node.parentId === this.zoomNode.id)) return false;
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
    if (this.zoomNode?.id === id) return false; // its siblings aren't rendered
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

  /** Mod+C or the row button: copy the node's ancestor path and subtree for an agent chat. */
  copyNodeContext(id: string): void {
    if (!this.tree.byId.has(id)) return;
    const { text, count } = serializeNodeContext(this.tree, id, this.serverId(id));
    writeClipboard(text).then(
      () => this.showToast(`Copied ${count} item${count === 1 ? "" : "s"}`),
      () => this.showToast("could not access the clipboard"),
    );
  }

  /** Mod+Shift+C or Mod-click on the row button: copy only the node's unformatted text. */
  copyNodeText(id: string, raw?: string): void {
    const text = rawNodeText(this.tree, id, raw);
    if (text === null) return;
    writeClipboard(text).then(
      () => this.showToast("Copied item text"),
      () => this.showToast("could not access the clipboard"),
    );
  }

  private deleteAndRefocus(id: string, recursive: boolean): void {
    if (!this.tree.byId.has(id)) return;
    const fallback = this.neighborOf(id);
    // Deleting the zoom root must not leave the view zoomed on a ghost:
    // capture its parent before the mutate and land the zoom there.
    const wasZoomRoot = this.zoomNode?.id === id;
    const zoomParent = this.zoomNode?.parentId ?? null;
    const applied = this.mutate(
      (nodes) => deleteNode(nodes, id, { recursive }).nodes,
      () => api.deleteNode(this.serverId(id), recursive),
    );
    if (!applied) return;
    if (wasZoomRoot) {
      this.setZoom(zoomParent);
      if (zoomParent !== null) void this.focus(zoomParent, "end");
      return;
    }
    if (fallback !== null) void this.focus(fallback, "end");
  }

  /**
   * Visible node that takes `id`'s rendered place after deletion: the first
   * row below its subtree, falling back to the row above at the end.
   */
  private neighborOf(id: string): string | null {
    const order = this.visibleIds;
    const index = order.indexOf(id);
    const doomed = subtreeIds(this.tree, id);
    for (let i = index + 1; i < order.length; i++) {
      const candidate = order[i];
      if (candidate !== undefined && !doomed.has(candidate)) return candidate;
    }
    return index > 0 ? (order[index - 1] ?? null) : null;
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
}
