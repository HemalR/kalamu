import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, offDefaultBranch, pathsFor, type KalamuPaths } from "@kalamu/core/store";
import { registerProject } from "./registry.js";

export class CliError extends Error {}

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
 * The outline is a committed file, so when the main checkout is on a branch
 * other than its default, every command — from any worktree — is reading and
 * writing that branch's copy (SPEC key decision 20). Kalamu cannot stop
 * `git checkout`; this makes the slip loud. stderr keeps it clear of
 * `--format json` stdout, and agents see it too: their writes are the ones
 * that would otherwise strand on the wrong branch.
 */
export function warnIfOffDefaultBranch(root: string): void {
  const drift = offDefaultBranch(root);
  if (drift === null) return;
  process.stderr.write(
    `kalamu: ${root} is on ${drift.head}, not ${drift.expected} — the outline here is that checkout's copy, ` +
      `not ${drift.expected}'s. Check out ${drift.expected} there and use a worktree for other branches.\n`,
  );
}

/** Existence lookup for `validate`'s doc-reference check (SPEC key decision 19): paths resolve against the repo root. */
export function docExistsUnder(repoRoot: string): (path: string) => boolean {
  return (path) => existsSync(join(repoRoot, path));
}

export function resolvePaths(cwd: string): KalamuPaths {
  const root = findRoot(cwd);
  if (!root) throw new CliError('not a Kalamu project (no .kalamu directory found) — run "kalamu init"');
  // Hub registration is a side effect of use (SPEC "Hub"); it never throws.
  registerProject(root);
  warnIfOffDefaultBranch(root);
  return pathsFor(root);
}

/** Every command returns this; the wiring decides how to print it. */
export interface CommandResult {
  text: string;
  json: unknown;
  /** 0 = ok; 1 = error; 2 = "nothing to do" (e.g. next with no eligible task). */
  exitCode?: number;
}
