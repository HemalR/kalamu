/**
 * The document layer of the outline store (see outline.svelte.ts for how the
 * layers fit together): the nodes themselves, the tree derived from them, and
 * everything that keeps both in step with the server — the SSE subscription,
 * the serialized write queue, undo/redo and the session-local id aliasing.
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
  buildTree,
  OperationError,
  progressByNode,
  type KalamuMeta,
  type KalamuNode,
} from "@kalamu/core";
import { api, ApiError } from "./api";

const UNDO_LIMIT = 100;
const TOAST_MS = 4000;

export class OutlineDocument {
  nodes = $state.raw<KalamuNode[]>([]);
  meta = $state.raw<KalamuMeta>({ version: 1 });
  loaded = $state(false);
  loadError = $state<string | null>(null);
  toast = $state<string | null>(null);

  /**
   * Server reachability. While false, every mutation refuses (mutate/restore/
   * enqueue callers early-return) and the UI drops into read-only mode — an
   * optimistic edit the server never sees would vanish on reload.
   */
  connected = $state(true);

  /**
   * Bumped on every SSE outline-changed event — a change signal, not data.
   * Fires only after the server's write has landed on disk (fs.watch → SSE),
   * so hub-mode consumers (the sidebar's open-task badges) can refetch
   * derived views without racing the outline file.
   */
  outlineChanges = $state(0);

  tree = $derived(buildTree(this.nodes));
  roots = $derived(this.tree.children.get(null) ?? []);
  /**
   * Subtree completion counts for every node, for the progress bars. One
   * bottom-up pass per outline change — never per row. Deliberately derived
   * from `tree`, not from the visible rows: filters and hideDone change what
   * is rendered, never the totals.
   */
  progress = $derived(progressByNode(this.tree));

  // Raw on purpose: these hold a snapshot of the whole outline per step, and
  // deep-proxying every one of them would cost real time for nothing — they are
  // only ever swapped out wholesale. Reactive so the palette can grey its rows.
  private undoStack = $state.raw<KalamuNode[][]>([]);
  private redoStack = $state.raw<KalamuNode[][]>([]);
  private toServer = new Map<string, string>();
  private toLocal = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private needsRefetch = false;
  private opVersion = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private stopEvents: (() => void) | undefined;
  private eventsPaused = false;

  // ---- server events ---------------------------------------------------------

  protected subscribeToEvents(): void {
    // pagehide can run while the initial requests are still in flight. In that
    // case init may finish, but the obsolete page must not open SSE.
    if (this.eventsPaused || this.stopEvents !== undefined) return;
    this.stopEvents = api.subscribe({
      onConnected: () => this.setConnected(true),
      onDisconnected: () => this.setConnected(false),
      onOutlineChanged: () => {
        this.outlineChanges++;
        void this.refetchNodes();
      },
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

  protected enqueue(persist: () => Promise<unknown>): void {
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
   *
   * `reportRefusal` toasts the refusal instead of swallowing it: an inert
   * indent needs no explanation, but "blocking would create a cycle" — the
   * same 400 the server would answer with — must reach the user.
   */
  protected mutate(
    local: (nodes: readonly KalamuNode[]) => KalamuNode[],
    persist: () => Promise<unknown>,
    options: { reportRefusal?: boolean } = {},
  ): boolean {
    if (!this.connected) return false; // read-only while the server is unreachable
    let next: KalamuNode[];
    try {
      next = local(this.nodes);
    } catch (err) {
      if (err instanceof OperationError) {
        if (options.reportRefusal === true) this.showToast(err.message);
        return false;
      }
      throw err;
    }
    this.undoStack = [...this.undoStack, this.nodes].slice(-UNDO_LIMIT);
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

  /** Inverse of serverId — the URL zoom hash carries server ids. */
  localId(id: string): string {
    return this.toLocal.get(id) ?? id;
  }

  protected adopt(localId: string, serverId: string): void {
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

  protected serverize(nodes: KalamuNode[]): KalamuNode[] {
    return nodes.map((n) => {
      const id = this.serverId(n.id);
      const parentId = n.parentId === null ? null : this.serverId(n.parentId);
      return id === n.id && parentId === n.parentId ? n : { ...n, id, parentId };
    });
  }

  // ---- undo / redo -----------------------------------------------------------

  /** The palette greys its Undo/Redo rows on these. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    this.restore("undo");
  }

  redo(): void {
    this.restore("redo");
  }

  /** Take the newest snapshot off one stack, handing the current one to the other. */
  private restore(direction: "undo" | "redo"): void {
    const undoing = direction === "undo";
    const source = undoing ? this.undoStack : this.redoStack;
    const target = source.at(-1);
    if (!this.connected || target === undefined) return;
    const rewound = source.slice(0, -1);
    const handed = [...(undoing ? this.redoStack : this.undoStack), this.nodes];
    this.undoStack = undoing ? rewound : handed;
    this.redoStack = undoing ? handed : rewound;
    this.opVersion++;
    this.nodes = target;
    this.enqueue(() => api.replaceNodes(this.serverize(target)));
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
