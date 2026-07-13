/**
 * Typed client for the local Kalamu server. The browser never touches files;
 * every read/write goes through these endpoints (SPEC "Local server").
 */
import type { Assignee, KalamuMeta, KalamuNode, NodeKind, UiState } from "@kalamu/core";

export type Priority = 1 | 2 | 3 | 4 | 5;

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

export const api = {
  getNodes: () => request<{ nodes: KalamuNode[] }>("/api/nodes"),
  /** Whole-outline replace; exists for undo/redo snapshot-restore. */
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
  /** Pasted image → content-hashed file in .kalamu/assets/ (SPEC key decision 11). */
  uploadAsset: (blob: Blob) =>
    request<{ path: string; url: string }>("/api/assets", {
      method: "POST",
      headers: { "content-type": blob.type },
      body: blob,
    }),
};
