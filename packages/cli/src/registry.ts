/**
 * Machine-global project registry backing `kalamu hub` (SPEC "Hub").
 * ~/.kalamu/projects.json is plumbing, never canonical data: registration is a
 * side effect of using the CLI in a project, deleting the file only loses the
 * sidebar list, and a broken registry must never break the command that
 * triggered it.
 */
import { KALAMU_DIR, OUTLINE_FILE } from "@kalamu/core/store";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { projectName } from "./server.js";

export interface RegistryEntry {
  slug: string;
  path: string;
  registeredAt: string;
  lastSeenAt: string;
}

export interface Registry {
  version: 1;
  projects: RegistryEntry[];
}

/** KALAMU_REGISTRY exists so tests never touch the real ~/.kalamu. */
export function defaultRegistryFile(): string {
  return process.env.KALAMU_REGISTRY ?? join(homedir(), ".kalamu", "projects.json");
}

/** package.json name (scope stripped) or directory name → URL slug; never empty. */
export function slugify(name: string): string {
  const slug = name
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** Read the registry, dropping entries whose project no longer has a .kalamu/ dir. */
export function readRegistry(file = defaultRegistryFile()): Registry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { version: 1, projects: [] };
  }
  const projects: RegistryEntry[] = [];
  const raw = parsed !== null && typeof parsed === "object" ? (parsed as { projects?: unknown }).projects : undefined;
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.slug !== "string" || typeof e.path !== "string") continue;
    // Same project test as findRoot: the outline file, not just the directory.
    if (!existsSync(join(e.path, KALAMU_DIR, OUTLINE_FILE))) continue;
    projects.push({
      slug: e.slug,
      path: e.path,
      registeredAt: typeof e.registeredAt === "string" ? e.registeredAt : "",
      lastSeenAt: typeof e.lastSeenAt === "string" ? e.lastSeenAt : "",
    });
  }
  return { version: 1, projects };
}

/**
 * Upsert the project at `root` (absolute path). New projects get a slug derived
 * from the package.json name (else the directory name), deduplicated with
 * numeric suffixes; existing projects keep their slug forever so hub bookmarks
 * survive renames (SPEC key decision 12). Never throws.
 */
export function registerProject(root: string, file = defaultRegistryFile()): void {
  try {
    const registry = readRegistry(file);
    const now = new Date().toISOString();
    const existing = registry.projects.find((p) => p.path === root);
    if (existing) {
      existing.lastSeenAt = now;
    } else {
      const base = slugify(projectName(root));
      const taken = new Set(registry.projects.map((p) => p.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      registry.projects.push({ slug, path: root, registeredAt: now, lastSeenAt: now });
    }
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    renameSync(temp, file);
  } catch {
    // registry failures degrade the hub, never the command that triggered them
  }
}
