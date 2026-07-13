import { existsSync } from "node:fs";
import { join } from "node:path";
import { findRoot, pathsFor, type KalamuPaths } from "@kalamu/core/store";
import { registerProject } from "./registry.js";

export class CliError extends Error {}

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

export function resolvePaths(cwd: string): KalamuPaths {
  const root = findRoot(cwd);
  if (!root) throw new CliError('not a Kalamu project (no .kalamu directory found) — run "kalamu init"');
  // Hub registration is a side effect of use (SPEC "Hub"); it never throws.
  registerProject(root);
  return pathsFor(root);
}

/** Every command returns this; the wiring decides how to print it. */
export interface CommandResult {
  text: string;
  json: unknown;
  /** 0 = ok; 1 = error; 2 = "nothing to do" (e.g. next with no eligible task). */
  exitCode?: number;
}
