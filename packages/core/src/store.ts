/**
 * Node-only file access. Every write follows SPEC "Concurrency": read +
 * record mtime, apply in memory, re-check mtime, temp file, atomic rename.
 * On a detected conflict the operation is re-applied once against fresh
 * state, then fails loudly.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseJsonl, serializeJsonl } from "./jsonl.js";
import { metaSchema, uiStateSchema, type KalamuMeta, type KalamuNode, type UiState } from "./model.js";

export class StoreError extends Error {}
export class ConflictError extends StoreError {}

export const KALAMU_DIR = ".kalamu";
export const OUTLINE_FILE = "outline.jsonl";
export const META_FILE = "meta.json";
export const UI_STATE_FILE = "ui-state.json";

export interface KalamuPaths {
  root: string;
  dir: string;
  outline: string;
  meta: string;
  uiState: string;
}

export function pathsFor(root: string): KalamuPaths {
  const dir = join(root, KALAMU_DIR);
  return {
    root,
    dir,
    outline: join(dir, OUTLINE_FILE),
    meta: join(dir, META_FILE),
    uiState: join(dir, UI_STATE_FILE),
  };
}

/**
 * A project is a directory whose .kalamu/ contains outline.jsonl — the dir
 * alone doesn't count, because the machine-global ~/.kalamu (hub registry,
 * logs) would otherwise make the home directory masquerade as a project for
 * everything beneath it.
 */
function isProject(dir: string): boolean {
  try {
    return statSync(join(dir, KALAMU_DIR, OUTLINE_FILE)).isFile();
  } catch {
    return false;
  }
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
 * its default branch checked out, else null. The outline is a committed file,
 * so a non-default branch in the main checkout swaps it for that branch's copy
 * under every reader and writer — linked worktrees included, since they
 * resolve here (SPEC key decision 20). Read from git's on-disk layout, no git
 * binary: `.git/HEAD` names the branch (a bare hash is a detached HEAD, reported
 * as `detached HEAD <short hash>`), and the default is what `origin/HEAD` points
 * at, else whichever of `main`/`master` exists locally. Null when `root` is not
 * a git checkout, when no default can be determined, or on the default branch.
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

function mtimeOf(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, "utf8");
  renameSync(temp, path);
}

export function readOutline(outlinePath: string): { nodes: KalamuNode[]; mtimeMs: number | null } {
  let content: string;
  try {
    content = readFileSync(outlinePath, "utf8");
  } catch {
    throw new StoreError(`no outline at ${outlinePath} — run "kalamu init" first`);
  }
  const { nodes, errors } = parseJsonl(content);
  if (errors.length) {
    const first = errors[0];
    throw new StoreError(
      `outline has ${errors.length} invalid line(s) (first: line ${first?.line}: ${first?.message}) — run "kalamu validate"`,
    );
  }
  return { nodes, mtimeMs: mtimeOf(outlinePath) };
}

/**
 * Apply a pure operation to the outline with conflict detection.
 * `operation` must be safe to re-run against fresher state.
 */
export function withOutline<T>(
  outlinePath: string,
  operation: (nodes: KalamuNode[]) => { nodes: KalamuNode[]; result: T },
): T {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { nodes, mtimeMs } = readOutline(outlinePath);
    const applied = operation(nodes);
    if (mtimeOf(outlinePath) !== mtimeMs) continue; // someone wrote meanwhile: retry once
    atomicWrite(outlinePath, serializeJsonl(applied.nodes));
    return applied.result;
  }
  throw new ConflictError(`outline at ${outlinePath} keeps changing under us; retry the command`);
}

export function writeOutline(outlinePath: string, nodes: readonly KalamuNode[]): void {
  atomicWrite(outlinePath, serializeJsonl(nodes));
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

/**
 * Create .kalamu/ at `root` unless a project is already there. A linked
 * worktree of an initialised checkout counts as already initialised — the
 * returned paths are the main checkout's, never a second outline (SPEC key
 * decision 20).
 */
export function initKalamu(root: string): InitResult {
  const existing = projectRootAt(root);
  if (existing !== null) return { created: false, paths: pathsFor(existing) };
  const paths = pathsFor(root);
  mkdirSync(paths.dir, { recursive: true });
  if (mtimeOf(paths.outline) === null) atomicWrite(paths.outline, "");
  if (mtimeOf(paths.meta) === null) writeMeta(paths.meta, { version: 1 });
  return { created: true, paths };
}
