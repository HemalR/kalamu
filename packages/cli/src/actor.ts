/**
 * Who is writing (SPEC key decision 15). Provenance is resolved, never asked
 * for: an agent that has to remember a flag will forget it, and a `createdBy`
 * that is wrong half the time is worse than no field at all.
 *
 * The TTY test is the same one `isInteractive` uses to keep update banners away
 * from agents (key decision 14) — a non-interactive invocation is an agent or a
 * script, an interactive one is the developer typing. The web UI never goes
 * through here; it passes "human" explicitly.
 */
import type { Assignee } from "@kalamu/core";
import { CliError, isInteractive } from "./context.js";

/** Parses `--by`, which overrides every other signal. */
export function parseActor(value: string): Assignee {
  if (value === "human" || value === "agent") return value;
  throw new CliError(`invalid --by "${value}" (expected human or agent)`);
}

/**
 * Resolution order: explicit flag, then KALAMU_ACTOR, then the TTY heuristic.
 * An unrecognised KALAMU_ACTOR is ignored rather than fatal — a stray value in
 * a shell profile should never stop the developer writing a node.
 */
export function resolveActor(flag?: string | undefined): Assignee {
  if (flag !== undefined) return parseActor(flag);
  const env = process.env["KALAMU_ACTOR"];
  if (env === "human" || env === "agent") return env;
  return isInteractive() ? "human" : "agent";
}
