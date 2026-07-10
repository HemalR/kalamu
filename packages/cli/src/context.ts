import { findRoot, pathsFor, type KalamuPaths } from "@kalamu/core/store";

export class CliError extends Error {}

export function resolvePaths(cwd: string): KalamuPaths {
  const root = findRoot(cwd);
  if (!root) throw new CliError('not a Kalamu project (no .kalamu directory found) — run "kalamu init"');
  return pathsFor(root);
}

/** Every command returns this; the wiring decides how to print it. */
export interface CommandResult {
  text: string;
  json: unknown;
  /** 0 = ok; 1 = error; 2 = "nothing to do" (e.g. next with no eligible task). */
  exitCode?: number;
}
