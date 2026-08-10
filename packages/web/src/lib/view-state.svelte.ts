/**
 * The view-state layer of the outline store (see outline.svelte.ts): what the
 * reader is looking at, never what the document says. Filters, hideDone,
 * compact mode, collapse, zoom, where attention is, and the focus registry.
 *
 * None of it is document content — collapse is view state by SPEC key decision
 * 10 and the rest follows the same rule: collapse, hideDone, compact and the
 * author/assignee filters live in ui-state.json, the tag filter and zoom are
 * session-only, and nothing here ever reaches the JSONL.
 */
import { ancestors, type Assignee, type KalamuNode, type OutlineFilters } from "@kalamu/core";
import { tick } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { api } from "./api";
import type { CaretPosition } from "./caret";
import { OutlineDocument } from "./document.svelte";
import {
  ASSIGNEE_VALUES,
  CREATED_BY_VALUES,
  axisAllows,
  filtersVisibleIds,
  narrowedFilters,
  tagVisibleIds,
  toggleAxis,
  type AssigneeFilter,
} from "./filter";
import { formatZoomHash } from "./zoom";

const UI_STATE_DEBOUNCE_MS = 400;

/** Where to put the caret when a node takes focus. */
export type FocusTarget = CaretPosition | { x: number; line: "first" | "last" };

/**
 * Registered by each OutlineNode. The node owns the editing/display swap, so
 * focusing must go through it: it mounts the editable, then places the caret.
 */
export interface NodeHandle {
  focusAt: (target: FocusTarget) => void;
}

export class OutlineViewState extends OutlineDocument {
  collapsed = new SvelteSet<string>();

  /** Active tag filter — session-only view state, never persisted (SPEC "Tags"). */
  filterTag = $state<string | null>(null);
  /** Hide completed nodes — persisted in ui-state.json like collapse state (view state, never document content); a hidden done node hides its whole subtree. */
  hideDone = $state(false);
  /**
   * Compact mode: rows render a short derived label (lib/summary.ts) instead of
   * their full text, so a deep tree can be scanned. Persisted alongside
   * hideDone, and render-time ONLY — the text on disk, copy-as-markdown, the
   * CLI and every filter keep seeing the full text.
   */
  compact = $state(false);
  /**
   * Author/assignee filters, driven by the header's filter menu and persisted
   * in ui-state.json (SPEC key decision 15). An absent axis shows everything.
   */
  filters = $state.raw<OutlineFilters>({});
  /**
   * Reprieved ids: visible until the filters next change, whatever the filters
   * say — hideDone included. Two sources, both cases where the reader's own
   * action put a node in front of them: creating one under an active filter
   * (revealNewNode) and jumping to one (revealNode).
   */
  private filterExtras = new SvelteSet<string>();

  private uiStateTimer: ReturnType<typeof setTimeout> | undefined;

  // ---- progress bar captions --------------------------------------------------
  // Every qualifying node renders its bar row unconditionally, so the outline
  // never reflows; only the caption comes and goes. These two ids say where
  // attention is, and captionIds turns them into one lookup for the rows.

  /** The node currently being edited — set when it enters editing, cleared when it leaves. */
  private caretId = $state<string | null>(null);
  /** The row under the pointer. */
  private hoverId = $state<string | null>(null);

  setCaret(id: string): void {
    this.caretId = id;
  }

  /**
   * Clears the caret only when `id` still owns it: when focus moves, the new
   * owner registers before the previous node tears its claim down.
   */
  clearCaret(id: string): void {
    if (this.caretId === id) this.caretId = null;
  }

  setHover(id: string): void {
    this.hoverId = id;
  }

  /** Same last-writer-wins guard as clearCaret, for pointerleave/pointerenter. */
  clearHover(id: string): void {
    if (this.hoverId === id) this.hoverId = null;
  }

  /**
   * Nodes whose progress bar shows its exact `3/7 (43%)` caption: the current
   * view root's own children (the sections of what you are looking at), plus
   * the caret's and the pointer's neighbourhoods — that node, its ancestors,
   * and its direct children. A union, so neither input suppresses the other.
   * One derived pass; no row walks the tree for this.
   */
  captionIds = $derived.by(() => {
    const ids = new Set<string>();
    for (const child of this.tree.children.get(this.zoomNode?.id ?? null) ?? []) ids.add(child.id);
    for (const id of [this.caretId, this.hoverId]) {
      const node = id === null ? undefined : this.tree.byId.get(id);
      if (node === undefined) continue;
      ids.add(node.id);
      for (const ancestor of ancestors(this.tree, node)) ids.add(ancestor.id);
      for (const child of this.tree.children.get(node.id) ?? []) ids.add(child.id);
    }
    return ids;
  });

  // ---- filters ----------------------------------------------------------------

  private tagMatches = $derived(this.filterTag === null ? null : tagVisibleIds(this.tree, this.filterTag));
  private attributeMatches = $derived(filtersVisibleIds(this.tree, this.filters));
  /** Whether the filter menu is currently narrowing the view — its active dot. */
  filtering = $derived(this.hideDone || narrowedFilters(this.filters) !== null);

  /** False only when the tag or author/assignee filters hide the node. Hidden nodes hide their subtrees. */
  isVisible(id: string): boolean {
    if (this.filterExtras.has(id)) return true;
    return (this.tagMatches?.has(id) ?? true) && (this.attributeMatches?.has(id) ?? true);
  }

  /**
   * The children of `id` that the active filters leave visible (render order).
   * hideDone honours filterExtras too: a hidden done node hides its whole
   * subtree, so a done ancestor would otherwise re-hide the very node a reveal
   * cleared the path to.
   */
  visibleChildren(id: string | null): KalamuNode[] {
    let children = this.tree.children.get(id) ?? [];
    if (this.hideDone) {
      children = children.filter((child) => child.doneAt === null || this.filterExtras.has(child.id));
    }
    if (this.tagMatches === null && this.attributeMatches === null) return children;
    return children.filter((child) => this.isVisible(child.id));
  }

  setFilter(tag: string | null): void {
    this.filterTag = tag;
    this.filterExtras.clear();
  }

  /** Whether an author/assignee value is currently shown (drives the menu's checkboxes). */
  showsCreatedBy(value: Assignee): boolean {
    return axisAllows(this.filters.createdBy, value);
  }

  showsAssignee(value: AssigneeFilter): boolean {
    return axisAllows(this.filters.assignee, value);
  }

  toggleCreatedByFilter(value: Assignee): void {
    this.setFilters({ ...this.filters, createdBy: toggleAxis(this.filters.createdBy, CREATED_BY_VALUES, value) });
  }

  toggleAssigneeFilter(value: AssigneeFilter): void {
    this.setFilters({ ...this.filters, assignee: toggleAxis(this.filters.assignee, ASSIGNEE_VALUES, value) });
  }

  /** The filter menu's Clear: back to showing everything, hideDone included. */
  resetFilters(): void {
    if (!this.filtering) return;
    this.hideDone = false;
    this.setFilters({});
  }

  private setFilters(next: OutlineFilters): void {
    this.filters = next;
    // Nodes kept alive by a previous filter state have had their reprieve.
    this.filterExtras.clear();
    this.persistUiStateSoon();
  }

  // ---- zoom (session view state; the URL hash is its only persistence) -------

  /** Never written to ui-state.json — that file is shared across tabs/agents. */
  zoomId = $state<string | null>(null);

  /**
   * All zoom behaviour keys off this: null when unzoomed OR when the node no
   * longer exists (deleted remotely), so a vanished zoom root degrades to the
   * unzoomed view; if an undo restores it, zoom resumes.
   */
  zoomNode = $derived(this.zoomId === null ? null : (this.tree.byId.get(this.zoomId) ?? null));

  /** What App renders at the top level: the zoomed node alone (its subtree beneath), else the visible roots. */
  displayRoots = $derived(this.zoomNode === null ? this.visibleChildren(null) : [this.zoomNode]);

  /** The zoomed node's ancestors, root→parent — the breadcrumb trail. */
  zoomPath = $derived(this.zoomNode === null ? [] : ancestors(this.tree, this.zoomNode));

  /**
   * Sets the zoom and syncs the URL hash (server ids, so links survive
   * reloads). Assigning location.hash pushes a history entry — Back then
   * unwinds zoom levels; applying an already-current hash (Back itself, or a
   * hashchange echo) writes nothing, so no loop and no duplicate entry.
   */
  setZoom(id: string | null): void {
    this.zoomId = id;
    const hash = formatZoomHash(id === null ? null : this.serverId(id));
    if (hash === "") {
      // hash = "" would leave a dangling "#"; pushState keeps Back unwinding.
      if (location.hash !== "") history.pushState(null, "", location.pathname + location.search);
    } else if (location.hash !== hash) {
      location.hash = hash;
    }
  }

  zoomIn(id: string): void {
    if (!this.tree.byId.has(id) || this.zoomId === id) return;
    this.setZoom(id);
    void this.focus(id, "end");
  }

  /** One level up; the previously-zoomed node is now visible, so focus it. */
  zoomOut(): void {
    const node = this.zoomNode;
    if (node === null) return;
    this.setZoom(node.parentId);
    void this.focus(node.id, "end");
  }

  /** Pre-order ids of nodes currently rendered (zoom-, collapse- and filter-aware); drives focus movement. */
  visibleIds = $derived.by(() => {
    const out: string[] = [];
    const walk = (parentId: string | null): void => {
      for (const child of this.visibleChildren(parentId)) {
        out.push(child.id);
        if (!this.collapsed.has(child.id)) walk(child.id);
      }
    };
    const root = this.zoomNode;
    if (root === null) {
      walk(null);
    } else {
      // The zoom root is always rendered, even when a tag filter would hide
      // it (same spirit as filterExtras); its descendants walk as usual.
      out.push(root.id);
      if (!this.collapsed.has(root.id)) walk(root.id);
    }
    return out;
  });

  // ---- reveal -----------------------------------------------------------------

  /**
   * Put a node in front of the reader wherever it is hiding, then focus it —
   * the app's one jump primitive (today: the blocked badge). Blockers cross the
   * tree freely (SPEC key decision 16), so the target is routinely outside the
   * zoom, folded away, or filtered out; each obstacle is cleared in turn.
   *
   * Nothing here is undone afterwards. setZoom pushes a history entry, so the
   * reader's way back is browser Back.
   */
  revealNode(id: string): void {
    const target = this.tree.byId.get(id);
    if (target === undefined) return;
    const trail = ancestors(this.tree, target);
    // Outside the current zoom: drop the zoom rather than re-zoom on some
    // common ancestor. Predictable beats clever — a computed new root would
    // land the reader in a view they never chose.
    if (this.zoomId !== null && id !== this.zoomId && !trail.some((ancestor) => ancestor.id === this.zoomId)) {
      this.setZoom(null);
    }
    // The target's own fold is irrelevant to arriving at it.
    for (const ancestor of trail) this.unfold(ancestor.id);
    // Reprieve, not reset: the reader's filter is theirs and survives the jump.
    if (this.tagMatches !== null || this.attributeMatches !== null || this.hideDone) {
      this.filterExtras.add(id);
      for (const ancestor of trail) this.filterExtras.add(ancestor.id);
    }
    void this.focus(id, "end");
  }

  // ---- collapse state (view state, never document content) -------------------

  toggleCollapse(id: string): void {
    if (!this.collapsed.delete(id)) {
      if ((this.tree.children.get(id) ?? []).length === 0) return; // nothing to fold
      this.collapsed.add(id);
    }
    this.persistUiStateSoon();
  }

  /** Whether collapseChildren would act — folded already counts as nothing to do. */
  canCollapseChildren(id: string): boolean {
    return (this.tree.children.get(id) ?? []).length > 0 && !this.collapsed.has(id);
  }

  /** The collapse-only half of toggleCollapse (palette "Collapse children"); the caret stays put. */
  collapseChildren(id: string): void {
    if (!this.canCollapseChildren(id)) return;
    this.collapsed.add(id);
    this.persistUiStateSoon();
  }

  /**
   * The parent collapseParent would fold, or null when there is nothing
   * rendered above to fold: the node is gone, root-level, or the zoom root
   * (its parent is outside the view). Direct children of the zoom root have a
   * rendered parent — the zoom root — so they resolve normally.
   */
  private collapseParentTarget(id: string): string | null {
    if (this.zoomNode?.id === id) return null;
    return this.tree.byId.get(id)?.parentId ?? null;
  }

  /** Whether collapseParent would act — the palette greys its item on this. */
  canCollapseParent(id: string): boolean {
    return this.collapseParentTarget(id) !== null;
  }

  /** Mod+Shift+↑ / palette "Collapse parent": fold the parent's children and land the caret at its end. */
  collapseParent(id: string): void {
    const parentId = this.collapseParentTarget(id);
    if (parentId === null) return;
    // The parent cannot already be collapsed (its child was focused), but a
    // stale ui-state could say otherwise — then only the focus move remains.
    if (!this.collapsed.has(parentId)) {
      this.collapsed.add(parentId);
      this.persistUiStateSoon();
    }
    void this.focus(parentId, "end");
  }

  /** Whether expandChildren would act — the palette greys its item on this.
      No zoom guard: expanding descends INTO the view, never out of it. */
  canExpandChildren(id: string): boolean {
    return (this.tree.children.get(id) ?? []).length > 0;
  }

  /**
   * Mod+Shift+↓ / palette "Expand children": unfold the node's children and
   * land the caret at the end of the first visible child. On an already-
   * expanded node this is pure descent, so repeated presses walk down the
   * tree. When a filter/hideDone leaves no child visible, only the unfold
   * happens — focus never moves to a hidden node.
   */
  expandChildren(id: string): void {
    if (!this.canExpandChildren(id)) return;
    this.unfold(id);
    const first = this.visibleChildren(id)[0];
    if (first !== undefined) void this.focus(first.id, "end");
  }

  /**
   * Expand `id` if it is folded, persisting only when that changed something —
   * how every operation that puts a node inside `id` keeps it visible.
   */
  protected unfold(id: string): void {
    if (this.collapsed.delete(id)) this.persistUiStateSoon();
  }

  toggleHideDone(): void {
    this.hideDone = !this.hideDone;
    // hideDone is one of the filters filterExtras reprieves from, so flipping
    // it ends those reprieves, exactly as setFilters does.
    this.filterExtras.clear();
    this.persistUiStateSoon();
  }

  /** Swap every row between its full text and its derived label (view state only). */
  toggleCompact(): void {
    this.compact = !this.compact;
    this.persistUiStateSoon();
  }

  protected persistUiStateSoon(): void {
    clearTimeout(this.uiStateTimer);
    this.uiStateTimer = setTimeout(() => {
      const collapsed = [...this.collapsed]
        .filter((id) => this.tree.byId.has(id)) // prune deleted ids opportunistically
        .map((id) => this.serverId(id));
      // Defaults stay out of the file: only a filter that actually narrows is written.
      const filters = narrowedFilters(this.filters);
      api
        .putUiState({
          collapsed,
          ...(this.hideDone ? { hideDone: true } : {}),
          ...(this.compact ? { compact: true } : {}),
          ...(filters === null ? {} : { filters }),
        })
        .catch(() => {
          // View state only; losing a fold is harmless.
        });
    }, UI_STATE_DEBOUNCE_MS);
  }

  // ---- focus ------------------------------------------------------------------

  /** Focus handles by node id; OutlineNode registers via an attachment. */
  readonly handles = new Map<string, NodeHandle>();

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

  /** Fresh nodes must not vanish mid-typing under an active filter. */
  protected revealNewNode(id: string, caret: CaretPosition = "start"): void {
    if (this.tagMatches !== null || this.attributeMatches !== null) this.filterExtras.add(id);
    void this.focus(id, caret);
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
}
