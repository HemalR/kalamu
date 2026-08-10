/**
 * Pure helpers for the two states the outline surfaces beyond done: an agent's
 * claim (`startedAt` — SPEC key decision 17, tasks only) and what a task or
 * discussion waits on (`blockedBy` — key decision 16). No Svelte imports,
 * unit-tested.
 */
import type { KalamuNode, Tree } from "@kalamu/core";
import { summarize } from "./summary";

/** In progress: a claimed task that is still open (`▶` where the CLI prints `☐`). */
export function isStarted(node: KalamuNode): boolean {
  return node.kind === "task" && node.startedAt !== undefined && node.doneAt === null;
}

/**
 * Can this node be blocked? Tasks and discussions can (key decision 16, amended
 * 2026-08-10); bullets carry no state of their own, and core rejects them.
 * Anything may *be* a blocker — only the blocked side is restricted.
 */
export function isBlockable(node: KalamuNode): boolean {
  return node.kind !== "bullet";
}

/**
 * The blockers actually holding the node up, in `blockedBy` order. Done
 * blockers no longer block, and a dangling id cannot block either — deletes
 * strip references, so only a hand-edited file gets here and `kalamu validate`
 * reports it (SPEC "blockedBy").
 */
export function openBlockers(tree: Tree, node: KalamuNode): KalamuNode[] {
  return (node.blockedBy ?? []).flatMap((id) => {
    const blocker = tree.byId.get(id);
    return blocker !== undefined && blocker.doneAt === null ? [blocker] : [];
  });
}

/** How a node reads in a list or tooltip — empty text still needs a handle. */
export function nodeLabel(node: KalamuNode): string {
  const text = node.text.trim();
  return text === "" ? "(empty item)" : text;
}

/** Tooltip for the blocked badge: what the node is waiting on, one per line. */
export function blockedTitle(blockers: readonly KalamuNode[]): string {
  const head = blockers.length === 1 ? "Blocked by 1 open item:" : `Blocked by ${blockers.length} open items:`;
  return [head, ...blockers.map(nodeLabel)].join("\n");
}

/** Open tasks are what a blocked node usually waits on; done nodes are the last resort. */
function candidateRank(node: KalamuNode): number {
  if (node.doneAt !== null) return 2;
  return node.kind === "task" ? 0 : 1;
}

/**
 * What the palette's "Block on…" submenu offers for a blockable target (a task
 * or a discussion): every other node, minus the ones already recorded. Any kind
 * may block, and blockers cross the tree freely (key decision 16), so nothing
 * else is excluded here — a pick that would close a cycle is rejected by
 * core/the server, and the message says why.
 *
 * Ordered open tasks → open other kinds → done nodes, outline order within
 * each group (Array#sort is stable), so the likely picks are the first rows
 * rather than whatever the outline happens to start with.
 */
export function blockerCandidates(nodes: readonly KalamuNode[], target: KalamuNode): KalamuNode[] {
  const already = new Set(target.blockedBy ?? []);
  return nodes
    .filter((node) => node.id !== target.id && !already.has(node.id))
    .sort((a, b) => candidateRank(a) - candidateRank(b));
}

/** Beyond this a row is unreadable anyway, and the palette clamps it to one line. */
const LABEL_LIMIT = 80;

/**
 * How a node reads as one row of the "Block on…" list: its compact-mode
 * summary (lib/summary.ts) where there is one, hard-capped so a 400-character
 * node cannot push the real choices off the row. Display only — the pick still
 * records the node's id.
 */
export function candidateLabel(node: KalamuNode): string {
  const label = summarize(node.text) ?? nodeLabel(node);
  return label.length > LABEL_LIMIT ? `${label.slice(0, LABEL_LIMIT).trimEnd()}…` : label;
}

/** One row of the "Unblock…" submenu; a blocker whose node is gone keeps its raw id. */
export interface BlockerEntry {
  id: string;
  label: string;
  /** Done blockers stay listed (they are still recorded) but no longer hold the node. */
  open: boolean;
}

export function blockerEntries(tree: Tree, node: KalamuNode): BlockerEntry[] {
  return (node.blockedBy ?? []).map((id) => {
    const blocker = tree.byId.get(id);
    return blocker === undefined
      ? { id, label: `${id} (missing)`, open: false }
      : { id, label: nodeLabel(blocker), open: blocker.doneAt === null };
  });
}
