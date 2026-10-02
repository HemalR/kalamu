import { existsSync, realpathSync, statSync } from "node:fs";
import { extname, join, sep } from "node:path";
import { OperationError } from "@kalamu/core";
import {
  checkoutRoots,
  ConflictError,
  dataHomeSetting,
  findRoot,
  InvalidOutlineError,
  kalamuHome,
  offDefaultBranch,
  pathsFor,
  type KalamuPaths,
} from "@kalamu/core/store";
import { registerProject } from "./registry.js";

/** A refused command; `code` as in OperationError. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly code?: "not-found",
  ) {
    super(message);
  }
}

export type ErrorCode = "not-found" | "cycle" | "conflict" | "invalid-outline" | "error";

/**
 * The stable code agents (`--format json`) and the web UI (the HTTP error
 * envelope) branch on; everything without one is plain "error".
 */
export function errorCode(err: Error): ErrorCode {
  if (err instanceof ConflictError) return "conflict";
  if (err instanceof InvalidOutlineError) return "invalid-outline";
  if (err instanceof OperationError || err instanceof CliError) return err.code ?? "error";
  return "error";
}

/**
 * "Is a human at the keyboard?" — gates update banners (SPEC key decision 14),
 * init prompts, and the createdBy provenance heuristic (key decision 15).
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Heuristic for "this directory is a code repository": a common repo marker
 * directly in the directory — `.git` covers any language (a file in worktrees,
 * hence existsSync not a dir check); `.gitignore`/`package.json` cover fresh
 * projects where `git init` hasn't run yet. Deliberately no walk-up: Kalamu is
 * repo-local, so an init anywhere but a repo root is suspect. Only interactive
 * init consults this — agents and scripts are never prompted.
 */
export function looksLikeRepo(dir: string): boolean {
  return [".git", ".gitignore", "package.json"].some((marker) => existsSync(join(dir, marker)));
}

/**
 * A repo-store outline is a committed file, so when the main checkout is on a
 * branch other than its default, every command — from any worktree — is
 * reading and writing that branch's copy (SPEC key decision 20). Kalamu cannot
 * stop `git checkout`; this makes the slip loud. stderr keeps it clear of
 * `--format json` stdout, and agents see it too: their writes are the ones
 * that would otherwise strand on the wrong branch. A local-store outline is
 * outside git, so branches cannot swap it and nothing is said.
 */
export function warnIfOffDefaultBranch(paths: KalamuPaths): void {
  if (paths.store !== "repo") return;
  const drift = offDefaultBranch(paths.root);
  if (drift === null) return;
  process.stderr.write(
    `kalamu: ${paths.root} is on ${drift.head}, not ${drift.expected} — the outline here is that checkout's copy, ` +
      `not ${drift.expected}'s. Check out ${drift.expected} there and use a worktree for other branches.\n`,
  );
}

/**
 * Where a doc reference (SPEC key decision 19) resolves: the absolute path of
 * the repo-relative `.md` file in the first checkout that has it, else null.
 * Every checkout, not just the main one: the outline is shared by all of them,
 * so a node can point at a plan that exists only on a worktree's branch until
 * it merges. Backs both `validate`'s missing-doc warning and the `/docs/*`
 * route, so a reference that validates also opens. Paths escaping a checkout
 * never resolve.
 */
export function findDoc(root: string, path: string): string | null {
  if (extname(path) !== ".md") return null;
  for (const checkout of checkoutRoots(root)) {
    // Real paths on both sides, so neither `..` nor a symlink can reach outside.
    const full = realpathOrNull(join(checkout, path));
    const base = realpathOrNull(checkout);
    if (full === null || base === null || !full.startsWith(base + sep) || extname(full) !== ".md") continue;
    if (statSync(full).isFile()) return full;
  }
  return null;
}

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Why a local-store project has no outline on this machine. The likely case
 * is not a fresh clone but a process with a different data home (an agent
 * sandbox, another account), where `kalamu init` would silently start a
 * second, empty outline — so the message says where it looked, and why.
 */
function missingDataMessage(paths: KalamuPaths): string {
  const home = dataHomeSetting();
  const why = {
    KALAMU_DATA_DIR: "set by KALAMU_DATA_DIR",
    config: `set by dataDir in ${join(kalamuHome(), "config.json")}`,
    default: "the default — neither KALAMU_DATA_DIR nor a configured data-dir is set",
  }[home.source];
  return (
    `no outline for project ${paths.id} in data home ${home.path} (${why}). ` +
    "If this project's data lives under another data home, point KALAMU_DATA_DIR or `kalamu config data-dir` at it. " +
    'Run "kalamu init" only for a genuinely fresh project: it creates a new, empty outline.'
  );
}

export function resolvePaths(cwd: string): KalamuPaths {
  const root = findRoot(cwd);
  if (!root) throw new CliError('not a Kalamu project (no .kalamu directory found) — run "kalamu init"');
  // Hub registration is a side effect of use (SPEC "Hub"); it never throws.
  registerProject(root);
  const paths = pathsFor(root);
  if (paths.store === "local" && !existsSync(paths.outline)) throw new CliError(missingDataMessage(paths));
  warnIfOffDefaultBranch(paths);
  return paths;
}

/** Every command returns this; the wiring decides how to print it. */
export interface CommandResult<J = unknown> {
  text: string;
  json: J;
  /** See EXIT_CODES; set here only for 2, "nothing to do" (e.g. next with no eligible task). */
  exitCode?: number;
}

/** Process exit codes agents can branch on (SPEC "CLI requirements"). */
export const EXIT_CODES = { ok: 0, error: 1, nothing: 2, conflict: 3 } as const;
