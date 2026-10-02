/**
 * Client for the hub's machine-global project registry (`kalamu hub`; SPEC
 * "Hub"). These endpoints are deliberately NOT prefixed with apiBase — they
 * belong to the hub, not to the project the page is showing. Every call is
 * quiet on failure: the sidebar keeps whatever it was showing.
 */

export interface HubProject {
  slug: string;
  name: string;
  path: string;
  /** #rrggbb — the override if set, else derived from the slug (server decides). */
  color: string;
  openTasks: number | null;
  lastSeenAt: string;
  /** The outline file is gone from `path` — kept listed so the path stays findable. */
  missing: boolean;
}

/** The fields a PATCH may change; a blank name or colour clears the override. */
export interface ProjectPatch {
  name?: string;
  color?: string;
  /** Final 0-based position in the registry (sidebar) order. */
  index?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isHubProject(value: unknown): value is HubProject {
  return (
    isRecord(value) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.path === "string" &&
    typeof value.color === "string" &&
    (value.openTasks === null || typeof value.openTasks === "number") &&
    typeof value.lastSeenAt === "string" &&
    typeof value.missing === "boolean"
  );
}

async function json(response: Response): Promise<unknown> {
  return response.ok ? response.json() : null;
}

/** The registry in sidebar order; null when it can't be read (no hub, or a failed request). */
export async function fetchProjects(): Promise<HubProject[] | null> {
  try {
    const body = await json(await fetch("/api/projects"));
    return isRecord(body) && Array.isArray(body.projects) ? body.projects.filter(isHubProject) : null;
  } catch {
    return null;
  }
}

/** Apply `patch`; the effective name and colour come back (a clear reverts to the derived value), or null on failure. */
export async function patchProject(slug: string, patch: ProjectPatch): Promise<Pick<HubProject, "name" | "color"> | null> {
  try {
    const response = await fetch(`/api/projects/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await json(response);
    return isRecord(body) && typeof body.name === "string" && typeof body.color === "string"
      ? { name: body.name, color: body.color }
      : null;
  } catch {
    return null;
  }
}

/** Deregister a project — non-destructive, it re-registers on its next CLI use. */
export async function removeProject(slug: string): Promise<boolean> {
  try {
    return (await fetch(`/api/projects/${slug}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}

/**
 * Where a row dragged from `from` lands when dropped on the row at `target`,
 * above or `below` it: the final 0-based index, which is what the server's
 * remove-then-insert takes — one less than the insertion point when the
 * dragged row sits above it, since its removal shifts the rest up.
 */
export function dropIndex(from: number, target: number, below: boolean): number {
  const insertAt = below ? target + 1 : target;
  return from < insertAt ? insertAt - 1 : insertAt;
}
