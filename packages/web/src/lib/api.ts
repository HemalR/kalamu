/**
 * Typed client for the local Kalamu server. The browser never touches files;
 * every read/write goes through these endpoints (SPEC "Local server").
 */
import type { Assignee, KalamuMeta, KalamuNode, NodeKind, UiState } from "@kalamu/core";

export type Priority = 1 | 2 | 3;

/**
 * Under `kalamu hub` the same SPA is served at /p/<slug> with the project's
 * API at /p/<slug>/api/* (and assets at /p/<slug>/assets/*); standalone it
 * lives at / with no prefix. Derived once at startup; "" when standalone.
 * Guarded so Node-side tests can import this module without a `location`.
 */
const hubMatch = typeof location === "undefined" ? null : /^\/p\/([a-z0-9-]+)/.exec(location.pathname);
export const apiBase = hubMatch === null ? "" : `/p/${hubMatch[1]}`;

export interface CreateNodeBody {
  parentId?: string | null;
  kind?: NodeKind;
  text: string;
  priority?: Priority;
  tags?: string[];
  assignee?: Assignee;
  afterId?: string;
  beforeId?: string;
}

export interface PatchNodeBody {
  text?: string;
  kind?: NodeKind;
  priority?: Priority | "default";
  /** "human" | "agent" assigns; null clears back to unassigned. */
  assignee?: Assignee | null;
}

export interface MoveNodeBody {
  parentId?: string | null;
  afterId?: string;
  beforeId?: string;
}

/** platform + hubInstalled drive HubHint's discovery messages (SPEC "Hub > Discovery"). */
export interface ProjectInfo {
  name: string;
  platform: string;
  hubInstalled: boolean;
  /** Running CLI version, and the newer npm release when one is known (SPEC key decision 14). */
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiBase + path, init);
  } catch {
    throw new ApiError("cannot reach the kalamu server", 0);
  }
  if (!response.ok) {
    let message = `request failed (${response.status})`;
    try {
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // non-JSON error body; keep the status message
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Server-push notifications the store reacts to (SSE over HTTP; no-op in-memory). */
export interface BackendEvents {
  onConnected(): void;
  onDisconnected(): void;
  onOutlineChanged(): void;
  onMetaChanged(): void;
}

/**
 * Everything the UI needs from a backend. The default is the local Kalamu
 * server over HTTP; the landing-page demo swaps in an in-memory backend via
 * setBackend() so the identical UI runs with no server at all.
 */
export interface Backend {
  getNodes(): Promise<{ nodes: KalamuNode[] }>;
  /** Whole-outline replace; exists for undo/redo snapshot-restore. */
  replaceNodes(nodes: KalamuNode[]): Promise<{ nodes: KalamuNode[] }>;
  createNode(body: CreateNodeBody): Promise<KalamuNode>;
  patchNode(id: string, body: PatchNodeBody): Promise<KalamuNode>;
  deleteNode(id: string, recursive: boolean): Promise<{ id: string; deleted: number }>;
  moveNode(id: string, body: MoveNodeBody): Promise<KalamuNode>;
  markDone(id: string): Promise<KalamuNode>;
  reopen(id: string): Promise<KalamuNode>;
  getProject(): Promise<ProjectInfo>;
  getMeta(): Promise<KalamuMeta>;
  setTagColor(tag: string, color: string | null): Promise<KalamuMeta>;
  getUiState(): Promise<UiState>;
  putUiState(state: UiState): Promise<UiState>;
  /** Pasted image → content-hashed file in .kalamu/assets/ (SPEC key decision 11). */
  uploadAsset(blob: Blob): Promise<{ path: string; url: string }>;
  /** Start pushing change notifications; returns an idempotent stop function. */
  subscribe(events: BackendEvents): () => void;
}

interface EventStream {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  close(): void;
}

/**
 * Open the server's SSE stream and return its disposer. Keeping the listener
 * references here is deliberate: rapid hub navigation must be able to detach
 * every callback and close the underlying HTTP connection immediately.
 *
 * `createSource` is injectable so the lifecycle can be tested without a
 * browser EventSource implementation.
 */
export function subscribeToServerEvents(
  events: BackendEvents,
  createSource: (url: string) => EventStream = (url) => new EventSource(url),
): () => void {
  const source = createSource(`${apiBase}/api/events`);
  const onOpen: EventListener = () => events.onConnected();
  const onError: EventListener = () => events.onDisconnected();
  const onOutlineChanged: EventListener = () => events.onOutlineChanged();
  const onMetaChanged: EventListener = () => events.onMetaChanged();
  let stopped = false;

  // EventSource retries on its own: error means the server is gone, and open
  // fires again once it comes back.
  source.addEventListener("open", onOpen);
  source.addEventListener("error", onError);
  source.addEventListener("outline-changed", onOutlineChanged);
  source.addEventListener("meta-changed", onMetaChanged);

  return () => {
    if (stopped) return;
    stopped = true;
    source.removeEventListener("open", onOpen);
    source.removeEventListener("error", onError);
    source.removeEventListener("outline-changed", onOutlineChanged);
    source.removeEventListener("meta-changed", onMetaChanged);
    source.close();
  };
}

const httpBackend: Backend = {
  getNodes: () => request<{ nodes: KalamuNode[] }>("/api/nodes"),
  replaceNodes: (nodes: KalamuNode[]) => request<{ nodes: KalamuNode[] }>("/api/nodes", json("PUT", { nodes })),
  createNode: (body: CreateNodeBody) => request<KalamuNode>("/api/nodes", json("POST", body)),
  patchNode: (id: string, body: PatchNodeBody) =>
    request<KalamuNode>(`/api/nodes/${encodeURIComponent(id)}`, json("PATCH", body)),
  deleteNode: (id: string, recursive: boolean) =>
    request<{ id: string; deleted: number }>(`/api/nodes/${encodeURIComponent(id)}?recursive=${recursive}`, {
      method: "DELETE",
    }),
  moveNode: (id: string, body: MoveNodeBody) =>
    request<KalamuNode>(`/api/nodes/${encodeURIComponent(id)}/move`, json("POST", body)),
  markDone: (id: string) => request<KalamuNode>(`/api/nodes/${encodeURIComponent(id)}/done`, { method: "POST" }),
  reopen: (id: string) => request<KalamuNode>(`/api/nodes/${encodeURIComponent(id)}/reopen`, { method: "POST" }),
  getProject: () => request<ProjectInfo>("/api/project"),
  getMeta: () => request<KalamuMeta>("/api/meta"),
  setTagColor: (tag: string, color: string | null) =>
    request<KalamuMeta>(`/api/tags/${encodeURIComponent(tag)}`, json("PUT", { color })),
  getUiState: () => request<UiState>("/api/ui-state"),
  putUiState: (state: UiState) => request<UiState>("/api/ui-state", json("PUT", state)),
  uploadAsset: (blob: Blob) =>
    request<{ path: string; url: string }>("/api/assets", {
      method: "POST",
      headers: { "content-type": blob.type },
      body: blob,
    }),
  subscribe: subscribeToServerEvents,
};

/**
 * The active backend. An ESM live binding: `api.*` call sites always see the
 * current backend, so setBackend() before the store loads swaps everything.
 */
export let api: Backend = httpBackend;

export function setBackend(backend: Backend): void {
  api = backend;
}
