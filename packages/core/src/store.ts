/**
 * Node-only file access. Every write follows SPEC "Concurrency": read +
 * record mtime, apply in memory, re-check mtime, temp file, atomic rename.
 * On a detected conflict the operation is re-applied once against fresh
 * state, then fails loudly.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/** Walk up from cwd to the nearest directory containing .kalamu/. */
export function findRoot(cwd: string): string | null {
  let current = cwd;
  for (;;) {
    try {
      if (statSync(join(current, KALAMU_DIR)).isDirectory()) return current;
    } catch {
      // keep walking
    }
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

export function initKalamu(root: string): InitResult {
  const paths = pathsFor(root);
  if (mtimeOf(paths.outline) !== null) return { created: false, paths };
  mkdirSync(paths.dir, { recursive: true });
  if (mtimeOf(paths.outline) === null) atomicWrite(paths.outline, "");
  if (mtimeOf(paths.meta) === null) writeMeta(paths.meta, { version: 1 });
  return { created: true, paths };
}
