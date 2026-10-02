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
 * Undo restores whole-outline snapshots, so it must never cross a write made
 * elsewhere (an agent's `kalamu done`): restoring a snapshot from before it
 * would silently revert it. Two guards keep that true. Every whole-outline
 * write carries the version token the store last synced to, and the server
 * refuses it (409 conflict) once the file has moved on; and a refetch that
 * brings in someone else's change clears both history stacks, because every
 * snapshot in them predates that change.
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
/** Toasts with an action stay longer: reading and reaching for the button takes time. */
const ACTION_TOAST_MS = 7000;

/** A transient message, optionally with one action button (e.g. Undo after a delete). */
export interface Toast {
  message: string;
  action?: { label: string; run: () => void };
}

/** A node's content as the outline sees it: timestamps reduced to whether they are set, since the optimistic copy and the server stamp them independently. */
const signature = (n: KalamuNode): string =>
  JSON.stringify([n.id, n.parentId, n.kind, n.text, n.doneAt !== null, n.startedAt !== undefined, n.priority, n.assignee, n.createdBy, n.blockedBy]);

/** Same nodes, same content, same order — i.e. a refetch brought in nothing from another writer. */
function sameOutline(a: readonly KalamuNode[], b: readonly KalamuNode[]): boolean {
  return a.length === b.length && a.every((node, index) => {
    const other = b[index];
    return other !== undefined && (node === other || signature(node) === signature(other));
  });
}

/** What the store tells its host page; every hook is optional (the embed sets none). */
export interface StoreHooks {
  /** Something /api/project reports changed on the server (SSE); App refetches it. */
  onProjectChanged?: () => void;
  /** The zoom moved (a server id; null = unzoomed). App mirrors it into the URL hash. */
  onZoom?: (serverId: string | null) => void;
}

export class OutlineDocument {
  protected readonly hooks: StoreHooks;

  constructor(hooks: StoreHooks = {}) {
    this.hooks = hooks;
  }

  nodes = $state.raw<KalamuNode[]>([]);
  meta = $state.raw<KalamuMeta>({ version: 1 });
  loaded = $state(false);
  loadError = $state<string | null>(null);
  /** Set while the outline file on disk is structurally broken (a refetch got `invalid-outline`); App shows it as a banner. */
  outlineError = $state<string | null>(null);
  toast = $state<Toast | null>(null);

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
  /** History was dropped for an outside write since the last edit, so an empty undo can say why. */
  private historyCleared = false;
  /**
   * The outline version `nodes` is in step with: set by every adopted read
   * and every landed write. Whole-outline writes send it (see replaceAll).
   */
  protected version = "";
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
      onProjectChanged: () => this.hooks.onProjectChanged?.(),
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
      .then(async () => {
        await persist();
        // Serialized, so the newest written version is this write's. Adopt it
        // only if the write landed on the version we hold: otherwise another
        // writer got in between, and keeping the stale token makes any
        // whole-outline write 409 until a refetch has shown their change.
        const written = api.takeVersion();
        if (written !== null) {
          if (written.base === this.version) this.version = written.version;
          else this.needsRefetch = true;
        }
      })
      .catch((err: unknown) => {
        // A network-level failure means disconnected; the banner says so.
        if (err instanceof ApiError && err.status === 0) this.setConnected(false);
        else if (err instanceof ApiError && err.code === "conflict") {
          // A whole-outline write met a newer file: the refetch below brings
          // that change in, and no snapshot from before it may be restored.
          this.clearHistory();
          this.showToast("Outline changed elsewhere — reloaded (undo history cleared)");
        } else this.showToast(err instanceof Error ? err.message : "failed to save");
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
    const opVersion = this.opVersion;
    try {
      const { nodes, version } = await api.getNodes();
      if (this.opVersion === opVersion && this.pending === 0) {
        const next = this.localize(nodes);
        // Our own writes come back identical; anything else is another writer's.
        if (!sameOutline(this.nodes, next)) this.clearHistory();
        this.nodes = next;
        this.version = version;
        this.outlineError = null;
      } else {
        this.needsRefetch = true;
      }
    } catch (err) {
      // A broken file is worth a banner; anything else is the server briefly
      // unreachable, and the next SSE event or op retries.
      if (err instanceof ApiError && err.code === "invalid-outline") this.outlineError = err.message;
    }
  }

  /** Whole-outline write at the synced version (read when the queue runs it, after the writes before it). */
  protected replaceAll(nodes: KalamuNode[]): Promise<unknown> {
    return api.replaceNodes(this.serverize(nodes), this.version);
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
    this.historyCleared = false;
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
    if (!this.canUndo && this.historyCleared) this.showToast("Nothing to undo — the outline changed elsewhere");
    this.restore("undo");
  }

  /**
   * An Undo button for a toast about the change just made. It only acts while
   * that change is still the newest step — after any later edit it would undo
   * something else.
   */
  protected undoAction(): Toast["action"] {
    const step = this.undoStack.at(-1);
    return {
      label: "Undo",
      run: () => {
        if (this.undoStack.at(-1) === step) this.undo();
      },
    };
  }

  private clearHistory(): void {
    if (!this.canUndo && !this.canRedo) return;
    this.undoStack = [];
    this.redoStack = [];
    this.historyCleared = true;
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
    this.enqueue(() => this.replaceAll(target));
  }

  // ---- toast --------------------------------------------------------------------

  showToast(message: string, action?: Toast["action"]): void {
    this.toast = action === undefined ? { message } : { message, action };
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.dismissToast(), action === undefined ? TOAST_MS : ACTION_TOAST_MS);
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toast = null;
  }
}
