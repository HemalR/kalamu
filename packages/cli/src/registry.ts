/**
 * Machine-global project registry backing `kalamu hub` (SPEC "Hub").
 * ~/.kalamu/projects.json is plumbing, never canonical data: registration is a
 * side effect of using the CLI in a project, deleting the file only loses the
 * sidebar list, and a broken registry must never break the command that
 * triggered it.
 */
import { tagColor } from "@kalamu/core";
import { kalamuHome } from "@kalamu/core/store";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { projectName } from "./project-name.js";

export interface RegistryEntry {
  slug: string;
  path: string;
  registeredAt: string;
  lastSeenAt: string;
  /** Display-name override set by renaming in the hub; absent = derive via projectName(). */
  name?: string;
  /** Theme-colour override set in the hub sidebar; absent = derive via projectColor(). */
  color?: string;
}

export interface Registry {
  version: 1;
  projects: RegistryEntry[];
}

/** `<kalamu home>/projects.json`; KALAMU_REGISTRY overrides the file alone, so tests never touch the real one. */
export function defaultRegistryFile(): string {
  return process.env.KALAMU_REGISTRY ?? join(kalamuHome(), "projects.json");
}

/** How stale `lastSeenAt` may get before use rewrites it — it only picks where the hub root lands. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** package.json name (scope stripped) or directory name → URL slug; never empty. */
export function slugify(name: string): string {
  const slug = name
    .replace(/^@[^/]+\//, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "project";
}

/** #rrggbb only — what the palette swatches produce. */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * A project's theme colour: the sidebar-set override, else the slug hashed
 * into the shared palette — automatic, stable, and stored nowhere, the same
 * scheme as tag colours (SPEC key decision 7).
 */
export function projectColor(entry: Pick<RegistryEntry, "slug" | "color">): string {
  return entry.color ?? tagColor(entry.slug);
}

/**
 * One registry entry, read leniently: an entry without a slug and path is
 * dropped, and any other malformed field falls back to its default rather
 * than losing the entry.
 */
const entrySchema = z.object({
  slug: z.string(),
  path: z.string(),
  registeredAt: z.string().catch(""),
  lastSeenAt: z.string().catch(""),
  name: z.string().trim().min(1).optional().catch(undefined),
  color: z.string().refine(isHexColor).optional().catch(undefined),
});

/**
 * Read the registry. Entries are kept even when the project's outline file is
 * gone: a missing file is a data-loss signal the hub must surface with its
 * path (see `missing` in the hub's /api/projects), never quietly forget — the
 * registry is the only record of where the outline lived. `kalamu hub forget`
 * is the explicit way out.
 */
export function readRegistry(file = defaultRegistryFile()): Registry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { version: 1, projects: [] };
  }
  const raw = z.object({ projects: z.array(z.unknown()) }).safeParse(parsed);
  const projects = (raw.success ? raw.data.projects : []).flatMap((entry) => {
    const result = entrySchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
  return { version: 1, projects };
}

/**
 * Upsert the project at `root` (absolute path — a resolved project root, so a
 * linked worktree has already become its main checkout, SPEC key decision 20).
 * New projects get a slug derived from the package.json name (else the
 * directory name), deduplicated with numeric suffixes; existing projects keep
 * their slug forever so hub bookmarks survive renames (SPEC key decision 12).
 * Every CLI command calls this, unlocked, so it writes only when something
 * changed: a new entry, or a `lastSeenAt` more than an hour old. Never throws.
 */
export function registerProject(root: string, file = defaultRegistryFile(), now = new Date()): void {
  try {
    const registry = readRegistry(file);
    const existing = registry.projects.find((p) => p.path === root);
    if (existing) {
      if (now.getTime() - Date.parse(existing.lastSeenAt) < TOUCH_INTERVAL_MS) return;
      existing.lastSeenAt = now.toISOString();
    } else {
      const base = slugify(projectName(root));
      const taken = new Set(registry.projects.map((p) => p.slug));
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      registry.projects.push({ slug, path: root, registeredAt: now.toISOString(), lastSeenAt: now.toISOString() });
    }
    writeRegistry(registry, file);
  } catch {
    // registry failures degrade the hub, never the command that triggered them
  }
}

/** The registered hub slug for the project at `root`, if any. */
export function slugFor(root: string, file = defaultRegistryFile()): string | undefined {
  return readRegistry(file).projects.find((p) => p.path === root)?.slug;
}

/**
 * Remove the project with `slug` from the registry ("forget", SPEC "Hub").
 * The project's .kalamu/ data is untouched, and the next kalamu command run
 * inside it re-registers it. Returns false — never throws — when the slug is
 * unknown or the registry could not be written.
 */
export function unregisterProject(slug: string, file = defaultRegistryFile()): boolean {
  try {
    const registry = readRegistry(file);
    const remaining = registry.projects.filter((p) => p.slug !== slug);
    if (remaining.length === registry.projects.length) return false;
    writeRegistry({ version: 1, projects: remaining }, file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Set (or, with a blank name, clear) the display-name override for `slug`
 * (SPEC "Hub"). The slug — route identity — never changes. Returns the
 * effective display name, or null — never throws — when the slug is unknown
 * or the registry could not be written.
 */
export function renameProject(slug: string, name: string, file = defaultRegistryFile()): string | null {
  try {
    const registry = readRegistry(file);
    const entry = registry.projects.find((p) => p.slug === slug);
    if (!entry) return null;
    const trimmed = name.trim();
    if (trimmed === "") delete entry.name;
    else entry.name = trimmed;
    writeRegistry(registry, file);
    return entry.name ?? projectName(entry.path);
  } catch {
    return null;
  }
}

/**
 * Set (or, with a blank colour, clear) the theme-colour override for `slug`
 * (SPEC "Hub"). Returns the effective colour, or null — never throws — when
 * the slug is unknown or the registry could not be written.
 */
export function recolorProject(slug: string, color: string, file = defaultRegistryFile()): string | null {
  try {
    const registry = readRegistry(file);
    const entry = registry.projects.find((p) => p.slug === slug);
    if (!entry) return null;
    const trimmed = color.trim();
    if (trimmed === "") delete entry.color;
    else entry.color = trimmed;
    writeRegistry(registry, file);
    return projectColor(entry);
  } catch {
    return null;
  }
}

/**
 * Move the project with `slug` to 0-based position `index` (clamped to the
 * list). Registry array order is the hub sidebar's display order (SPEC
 * "Hub"), so this is the primitive behind drag-and-drop reordering. Returns
 * false — never throws — when the slug is unknown or the registry could not
 * be written.
 */
export function reorderProject(slug: string, index: number, file = defaultRegistryFile()): boolean {
  try {
    const registry = readRegistry(file);
    const from = registry.projects.findIndex((p) => p.slug === slug);
    if (from === -1) return false;
    const [entry] = registry.projects.splice(from, 1);
    if (entry === undefined) return false;
    registry.projects.splice(Math.max(0, Math.min(index, registry.projects.length)), 0, entry);
    writeRegistry(registry, file);
    return true;
  } catch {
    return false;
  }
}

function writeRegistry(registry: Registry, file: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(temp, file);
}
