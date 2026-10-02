/**
 * Node-only file access. Every write follows SPEC "Concurrency": read +
 * record the version token, apply in memory, re-check the token, fsynced temp
 * file, atomic rename. On a detected conflict the operation is re-applied once
 * against fresh state, then fails loudly.
 *
 * Where the files live is the project's store (SPEC key decision 21):
 * `repo` keeps everything committed under `<root>/.kalamu/`; `local` keeps a
 * committed marker there (`project.json`, holding an immutable id) and the
 * data itself under the machine-global data home, so every branch, worktree
 * and clone shares one outline.
 */
import { randomBytes } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { parseJsonl, serializeJsonl } from "./jsonl.js";
import { metaSchema, uiStateSchema, type KalamuMeta, type KalamuNode, type UiState } from "./model.js";
import { structuralErrors } from "./validate.js";

export class StoreError extends Error {}
/** Another writer got in first: retrying (or reloading) is the fix. */
export class ConflictError extends StoreError {}
/** The outline on disk has malformed lines or a broken tree; `kalamu validate` names them. */
export class InvalidOutlineError extends StoreError {}

export const KALAMU_DIR = ".kalamu";
export const OUTLINE_FILE = "outline.jsonl";
export const META_FILE = "meta.json";
export const UI_STATE_FILE = "ui-state.json";
/** The committed marker of a local-store project: `{"id": "<project id>"}`. */
export const PROJECT_FILE = "project.json";

export type StoreKind = "repo" | "local";
export const DEFAULT_STORE: StoreKind = "local";

export interface KalamuPaths {
  /** Project root: where `.kalamu/` sits and what doc/`@file` references resolve against. */
  root: string;
  /** The local-store project id from the marker; null for a repo-store project. */
  id: string | null;
  /** Where the outline and its siblings live: `<root>/.kalamu` (repo) or `<data home>/<id>` (local). */
  dir: string;
  outline: string;
  meta: string;
  uiState: string;
  store: StoreKind;
}

/** ~/.kalamu — machine-global state (registry, config, local-store data). KALAMU_HOME overrides it for tests. */
export function kalamuHome(): string {
  return process.env.KALAMU_HOME ?? join(homedir(), ".kalamu");
}

/** The one config.json key core reads; the rest of the file is CLI plumbing. */
const dataDirConfig = z.object({ dataDir: z.string().min(1).optional() });

/**
 * Where local-store project data lives, one directory per project id, and
 * which setting decided it: `KALAMU_DATA_DIR`, else `dataDir` in
 * `~/.kalamu/config.json` (a synced folder, say), else `~/.kalamu/projects`.
 */
export function dataHomeSetting(): { path: string; source: "KALAMU_DATA_DIR" | "config" | "default" } {
  const env = process.env.KALAMU_DATA_DIR;
  if (env !== undefined && env !== "") return { path: resolve(env), source: "KALAMU_DATA_DIR" };
  try {
    const { dataDir } = dataDirConfig.parse(JSON.parse(readFileSync(join(kalamuHome(), "config.json"), "utf8")));
    if (dataDir !== undefined) return { path: resolve(dataDir), source: "config" };
  } catch {
    // missing or corrupt config → default
  }
  return { path: join(kalamuHome(), "projects"), source: "default" };
}

export function dataHome(): string {
  return dataHomeSetting().path;
}

/** Safe as a directory name and stable across machines; see `newProjectId`. */
const markerSchema = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) });

/** `<directory name, slugified>-<6 hex>`: readable in a synced folder, unique enough, never changes. */
export function newProjectId(root: string): string {
  const slug = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "project"}-${randomBytes(3).toString("hex")}`;
}

/** The local-store marker at `root`, or null when the project keeps its data in the repo. */
export function readProjectMarker(root: string): { id: string } | null {
  const file = join(root, KALAMU_DIR, PROJECT_FILE);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoreError(`invalid ${file}: not JSON`);
  }
  const marker = markerSchema.safeParse(parsed);
  if (!marker.success) throw new StoreError(`invalid ${file}: expected {"id": "<lowercase letters, digits, dashes>"}`);
  return marker.data;
}

function writeProjectMarker(root: string, id: string): void {
  atomicWrite(join(root, KALAMU_DIR, PROJECT_FILE), `${JSON.stringify({ id })}\n`);
}

/** Where the project rooted at `root` keeps its data. Reads the marker, never the outline. */
export function pathsFor(root: string): KalamuPaths {
  const marker = readProjectMarker(root);
  const dir = marker ? join(dataHome(), marker.id) : join(root, KALAMU_DIR);
  return {
    root,
    id: marker?.id ?? null,
    dir,
    outline: join(dir, OUTLINE_FILE),
    meta: join(dir, META_FILE),
    uiState: join(dir, UI_STATE_FILE),
    store: marker ? "local" : "repo",
  };
}

/**
 * A project is a directory whose .kalamu/ holds an outline (repo store) or a
 * project marker (local store) — the dir alone doesn't count, because the
 * machine-global ~/.kalamu (hub registry, logs) would otherwise make the home
 * directory masquerade as a project for everything beneath it.
 */
function isProject(dir: string): boolean {
  const kalamu = join(dir, KALAMU_DIR);
  return existsSync(join(kalamu, OUTLINE_FILE)) || existsSync(join(kalamu, PROJECT_FILE));
}

/**
 * The main checkout's root when `dir` is the root of a linked git worktree,
 * else null. Read straight from git's on-disk layout, no git binary: a linked
 * worktree's `.git` is a file (`gitdir: <main>/.git/worktrees/<name>`) and that
 * directory's `commondir` points back at the shared `.git`. Submodules also
 * have a `.git` file but no `commondir`, so they stay their own project.
 */
function mainWorktreeRoot(dir: string): string | null {
  try {
    const dotGit = join(dir, ".git");
    if (!statSync(dotGit).isFile()) return null;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
    if (gitdir === undefined) return null;
    const worktreeGitdir = resolve(dir, gitdir);
    const commondir = readFileSync(join(worktreeGitdir, "commondir"), "utf8").trim();
    return dirname(resolve(worktreeGitdir, commondir));
  } catch {
    return null;
  }
}

/**
 * Every checkout of the repo at `root`: `root` itself, then each linked
 * worktree that still exists on disk. The inverse of `mainWorktreeRoot`, read
 * the same way, with no git binary: `.git/worktrees/<name>/gitdir` holds the
 * path of that worktree's `.git` file. Just `[root]` when `root` has none.
 */
export function checkoutRoots(root: string): string[] {
  const worktrees = join(root, ".git", "worktrees");
  let names: string[];
  try {
    names = readdirSync(worktrees);
  } catch {
    return [root];
  }
  const linked = names.flatMap((name) => {
    try {
      const dotGit = resolve(worktrees, name, readFileSync(join(worktrees, name, "gitdir"), "utf8").trim());
      return existsSync(dotGit) ? [dirname(dotGit)] : [];
    } catch {
      return [];
    }
  });
  return [root, ...linked];
}

/**
 * The project root `dir` itself resolves to, or null. A linked git worktree is
 * the same project as its main checkout (SPEC key decision 20): its own
 * committed .kalamu/ is ignored in favour of the main checkout's whenever that
 * checkout is a project, so every branch sees and writes one outline.
 */
function projectRootAt(dir: string): string | null {
  const main = mainWorktreeRoot(dir);
  if (main !== null && isProject(main)) return main;
  return isProject(dir) ? dir : null;
}

/** Does `refs/heads/<branch>` exist, loose or packed? */
function hasLocalBranch(gitDir: string, branch: string): boolean {
  try {
    statSync(join(gitDir, "refs", "heads", branch));
    return true;
  } catch {
    // fall through to packed-refs
  }
  try {
    return readFileSync(join(gitDir, "packed-refs"), "utf8").includes(` refs/heads/${branch}\n`);
  } catch {
    return false;
  }
}

/**
 * `{ head, expected }` when the checkout at `root` has something other than
 * its default branch checked out, else null. Only a repo-store outline cares:
 * it is a committed file, so a non-default branch in the main checkout swaps
 * it for that branch's copy under every reader and writer — linked worktrees
 * included, since they resolve here (SPEC key decision 20). Read from git's
 * on-disk layout, no git binary: `.git/HEAD` names the branch (a bare hash is
 * a detached HEAD, reported as `detached HEAD <short hash>`), and the default
 * is what `origin/HEAD` points at, else whichever of `main`/`master` exists
 * locally. Null when `root` is not a git checkout, when no default can be
 * determined, or on the default branch.
 */
export function offDefaultBranch(root: string): { head: string; expected: string } | null {
  const gitDir = join(root, ".git");
  let headFile: string;
  try {
    if (!statSync(gitDir).isDirectory()) return null;
    headFile = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
  const head = /^ref: refs\/heads\/(.+)$/.exec(headFile)?.[1] ?? `detached HEAD ${headFile.slice(0, 7)}`;
  let originHead: string | undefined;
  try {
    originHead = /^ref: refs\/remotes\/origin\/(.+)$/.exec(
      readFileSync(join(gitDir, "refs", "remotes", "origin", "HEAD"), "utf8").trim(),
    )?.[1];
  } catch {
    // no remote HEAD recorded; fall back to local convention
  }
  const expected = originHead ?? ["main", "master"].find((branch) => hasLocalBranch(gitDir, branch));
  if (expected === undefined || head === expected) return null;
  return { head, expected };
}

/** Walk up from cwd to the nearest project root (see `projectRootAt`). */
export function findRoot(cwd: string): string | null {
  let current = cwd;
  for (;;) {
    const root = projectRootAt(current);
    if (root !== null) return root;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const versionOf = (stat: Stats): string => `${stat.ino}-${stat.size}-${stat.mtimeMs}`;

/**
 * An opaque token that changes whenever the file is replaced or rewritten
 * (inode, size and mtime together — mtime alone can repeat within its
 * resolution), or null when the file is missing. Writers compare it to detect
 * a concurrent write; the server hands it to the UI as `X-Kalamu-Version` so a
 * whole-outline replace can refuse to clobber a newer file.
 */
export function outlineVersion(path: string): string | null {
  const stat = statSync(path, { throwIfNoEntry: false });
  return stat === undefined ? null : versionOf(stat);
}

/**
 * Temp file in the same directory, fsynced, renamed over `path`. Returns the
 * written file's version token, taken from the temp file before the rename
 * (which keeps inode, size and mtime) so no later writer can leak into it.
 */
function atomicWrite(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(temp, "w");
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const version = versionOf(statSync(temp));
  renameSync(temp, path);
  return version;
}

/**
 * Parse the outline, refusing one with malformed lines or a broken tree
 * (duplicate ids, missing parents, parent cycles): those nodes would vanish
 * from every view, and the next write would delete them for good. The
 * version is taken before the read, so a write racing it can only make the
 * token look stale, never newer than the content.
 */
export function readOutline(outlinePath: string): { nodes: KalamuNode[]; version: string } {
  const missing = new StoreError(`no outline at ${outlinePath}`);
  const version = outlineVersion(outlinePath);
  if (version === null) throw missing;
  let content: string;
  try {
    content = readFileSync(outlinePath, "utf8");
  } catch {
    throw missing; // deleted since the stat
  }
  const { nodes, errors } = parseJsonl(content);
  const problems = errors.length ? errors.map((e) => `line ${e.line}: ${e.message}`) : structuralErrors(nodes);
  if (problems.length) {
    throw new InvalidOutlineError(
      `outline at ${outlinePath} has ${problems.length} error(s) (first: ${problems[0]}) — run "kalamu validate" and fix the file by hand; Kalamu will not write until it is valid`,
    );
  }
  return { nodes, version };
}

/**
 * Apply a pure operation to the outline with conflict detection and write
 * its `nodes`. Returns everything the operation returned plus the version
 * token of the file it wrote, so callers destructure what they need:
 * `withOutline(path, (nodes) => markDone(nodes, id)).node`. The operation
 * gets the version it is working from (for a caller-side staleness check)
 * and must be safe to re-run against fresher state.
 */
export function withOutline<R extends { nodes: readonly KalamuNode[] }>(
  outlinePath: string,
  operation: (nodes: KalamuNode[], version: string) => R,
): R & { version: string } {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { nodes, version } = readOutline(outlinePath);
    const applied = operation(nodes, version);
    if (outlineVersion(outlinePath) !== version) continue; // someone wrote meanwhile: retry once
    return { ...applied, version: atomicWrite(outlinePath, serializeJsonl(applied.nodes)) };
  }
  throw new ConflictError(`outline at ${outlinePath} keeps changing under us; retry the command`);
}

export function readMeta(metaPath: string): KalamuMeta {
  let raw: string;
  try {
    raw = readFileSync(metaPath, "utf8");
  } catch {
    return { version: 1 };
  }
  const parsed = metaSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new StoreError(`invalid meta.json at ${metaPath}`);
  return parsed.data;
}

export function writeMeta(metaPath: string, meta: KalamuMeta): void {
  atomicWrite(metaPath, JSON.stringify(meta, null, 2) + "\n");
}

/** Never canonical: missing or corrupt just means "everything expanded". */
export function readUiState(uiStatePath: string): UiState {
  try {
    const parsed = uiStateSchema.safeParse(JSON.parse(readFileSync(uiStatePath, "utf8")));
    return parsed.success ? parsed.data : { collapsed: [] };
  } catch {
    return { collapsed: [] };
  }
}

export function writeUiState(uiStatePath: string, state: UiState): void {
  atomicWrite(uiStatePath, JSON.stringify(state) + "\n");
}

export interface InitResult {
  created: boolean;
  paths: KalamuPaths;
}

/** Empty outline + default meta, only where missing. */
function ensureDataFiles(paths: KalamuPaths): boolean {
  const fresh = !existsSync(paths.outline);
  mkdirSync(paths.dir, { recursive: true });
  if (fresh) atomicWrite(paths.outline, "");
  if (!existsSync(paths.meta)) writeMeta(paths.meta, { version: 1 });
  return fresh;
}

/**
 * Create a project at `root` unless one is already there. A linked worktree of
 * an initialised checkout counts as already initialised — the returned paths
 * are the main checkout's, never a second outline (SPEC key decision 20). An
 * existing project keeps its store; `store` only decides a fresh one. A
 * local-store project whose data is missing on this machine (a fresh clone
 * carrying the marker) gets an empty outline and reports `created`.
 */
export function initKalamu(root: string, options: { store?: StoreKind } = {}): InitResult {
  const existing = projectRootAt(root);
  if (existing !== null) {
    const paths = pathsFor(existing);
    return { created: ensureDataFiles(paths), paths };
  }
  if ((options.store ?? DEFAULT_STORE) === "local") writeProjectMarker(root, newProjectId(root));
  const paths = pathsFor(root);
  ensureDataFiles(paths);
  return { created: true, paths };
}

/** Everything that moves with the outline between stores. */
const DATA_ENTRIES = [OUTLINE_FILE, META_FILE, UI_STATE_FILE, "assets"];
/** Never canonical; dropped from a repo-store `.kalamu/` when the data leaves it. */
const REPO_LEFTOVERS = ["server.lock", "cache.sqlite"];

export interface MigrateResult {
  from: StoreKind;
  to: StoreKind;
  paths: KalamuPaths;
  /** Node count of the outline that moved — the human's check that nothing was lost. */
  nodes: number;
  /** Data entries (files or the assets dir) that existed and moved. */
  moved: string[];
}

function copyEntries(fromDir: string, toDir: string): string[] {
  const moved: string[] = [];
  for (const entry of DATA_ENTRIES) {
    const source = join(fromDir, entry);
    if (!existsSync(source)) continue;
    cpSync(source, join(toDir, entry), { recursive: true, force: true });
    moved.push(entry);
  }
  return moved;
}

/**
 * Move a project's data between stores (SPEC `kalamu migrate`). Copies the
 * outline, meta, view state and assets, switches the marker, then removes the
 * old copy — in that order, so an interruption leaves a readable project
 * (the marker decides which copy is live). To `local`, the data lands under a
 * fresh id; to `repo`, it overwrites whatever a stale branch left in
 * `.kalamu/` (dead by definition while the marker existed) and drops the data
 * home directory.
 */
export function migrateStore(root: string, to: StoreKind): MigrateResult {
  const before = pathsFor(root);
  if (before.store === to) throw new StoreError(`this project already keeps its outline in the ${to} store`);
  const { nodes } = readOutline(before.outline);
  if (to === "local") {
    const id = newProjectId(root);
    const dir = join(dataHome(), id);
    if (existsSync(dir)) throw new StoreError(`${dir} already exists — retry to draw a fresh id`);
    mkdirSync(dir, { recursive: true });
    const moved = copyEntries(before.dir, dir);
    writeProjectMarker(root, id);
    for (const entry of [...moved, ...REPO_LEFTOVERS]) rmSync(join(before.dir, entry), { recursive: true, force: true });
    return { from: "repo", to, paths: pathsFor(root), nodes: nodes.length, moved };
  }
  const dir = join(root, KALAMU_DIR);
  const moved = copyEntries(before.dir, dir);
  rmSync(join(dir, PROJECT_FILE), { force: true });
  // Only ever delete a directory the data home owns.
  if (dirname(before.dir) === dataHome()) rmSync(before.dir, { recursive: true, force: true });
  return { from: "local", to, paths: pathsFor(root), nodes: nodes.length, moved };
}
