/**
 * Subtree completion counts — how much of the work under a node is finished.
 *
 * Actionable units are tasks and discussions with non-blank text: the two
 * kinds that represent work to be done. Bullets are thinking, not work, and
 * never count (a done bullet is strikethrough only — SPEC key decision 3).
 *
 * A node's progress excludes the node itself and counts all actionable
 * descendants, however deeply nested. A task with three subtasks is therefore
 * three units. A done ancestor task closes its whole subtree (SPEC key decision
 * 4), so everything beneath it counts as done regardless of its own `doneAt`
 * — the same rule `eligibleTasks` applies, or the ring would disagree with
 * `next`. A done discussion closes nothing (key decision 12): its descendants
 * keep counting individually.
 *
 * Counts describe the real tree. Filters and hide-done change what is
 * rendered, never the totals — otherwise turning hide-done on would empty
 * every ring, and completing a task would make progress run backwards.
 */
import type { KalamuNode } from "./model.js";
import type { Tree } from "./tree.js";

export interface Progress {
  /** Actionable descendants of the node, excluding the node itself. */
  total: number;
  done: number;
  /** Claimed but unfinished — a task with `startedAt` and no `doneAt`. */
  active: number;
}

export interface ProgressOptions {
  /** Limit actionable units to one work-item kind. Omitted counts both. */
  kind?: "task" | "discussion";
}

/** Tasks and discussions carry work; blank rows are half-typed, not work. */
function isActionable(node: KalamuNode, options: ProgressOptions): boolean {
  const matchesKind = options.kind === undefined || node.kind === options.kind;
  return node.kind !== "bullet" && node.text.trim() !== "" && matchesKind;
}

/**
 * Progress for every node in the tree, keyed by id. One bottom-up pass — call
 * it once per outline change rather than once per row.
 */
function calculateProgress(tree: Tree, options: ProgressOptions = {}): { byNode: Map<string, Progress>; outline: Progress } {
  const out = new Map<string, Progress>();
  /** `closed` = a done ancestor task already finished everything below it. */
  const visit = (node: KalamuNode, closed: boolean): Progress => {
    const shut = closed || (node.kind === "task" && node.doneAt !== null);
    let ownTotal = 0;
    let ownDone = 0;
    let ownActive = 0;
    if (isActionable(node, options)) {
      ownTotal = 1;
      // A claim on a closed task is spent: closure wins, and a task can carry
      // both timestamps. Discussions are never claimed (no `kalamu start`).
      if (shut || node.doneAt !== null) ownDone = 1;
      else if (node.kind === "task" && node.startedAt !== undefined) ownActive = 1;
    }
    let descendants: Progress = { total: 0, done: 0, active: 0 };
    for (const child of tree.children.get(node.id) ?? []) {
      const sub = visit(child, shut);
      descendants.total += sub.total;
      descendants.done += sub.done;
      descendants.active += sub.active;
    }
    out.set(node.id, descendants);
    return {
      total: ownTotal + descendants.total,
      done: ownDone + descendants.done,
      active: ownActive + descendants.active,
    };
  };
  const outline: Progress = { total: 0, done: 0, active: 0 };
  for (const root of tree.children.get(null) ?? []) {
    const sub = visit(root, false);
    outline.total += sub.total;
    outline.done += sub.done;
    outline.active += sub.active;
  }
  return { byNode: out, outline };
}

export function progressByNode(tree: Tree, options: ProgressOptions = {}): Map<string, Progress> {
  return calculateProgress(tree, options).byNode;
}

/** Progress for one subtree; `rootId: null` totals the whole outline. */
export function progressOf(tree: Tree, rootId: string | null, options: ProgressOptions = {}): Progress {
  const result = calculateProgress(tree, options);
  return rootId === null ? result.outline : (result.byNode.get(rootId) ?? { total: 0, done: 0, active: 0 });
}
