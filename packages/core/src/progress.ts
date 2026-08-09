/**
 * Subtree completion counts — how much of the work under a node is finished.
 *
 * Actionable units are tasks and discussions with non-blank text: the two
 * kinds that represent work to be done. Bullets are thinking, not work, and
 * never count (a done bullet is strikethrough only — SPEC key decision 3).
 *
 * A node counts ITSELF when it is actionable, so a task with three subtasks is
 * four units: the children being finished does not finish the parent's own
 * work. A done ancestor task closes its whole subtree (SPEC key decision 4),
 * so everything beneath it counts as done regardless of its own `doneAt` —
 * the same rule `eligibleTasks` applies, or the ring would disagree with
 * `next`. A done discussion closes nothing (key decision 12): it counts as one
 * finished unit and its children keep counting individually.
 *
 * Counts describe the real tree. Filters and hide-done change what is
 * rendered, never the totals — otherwise turning hide-done on would empty
 * every ring, and completing a task would make progress run backwards.
 */
import type { KalamuNode } from "./model.js";
import type { Tree } from "./tree.js";

export interface Progress {
  /** Actionable units in the subtree, the node itself included. */
  total: number;
  done: number;
  /** Claimed but unfinished — a task with `startedAt` and no `doneAt`. */
  active: number;
}

/** Tasks and discussions carry work; blank rows are half-typed, not work. */
function isActionable(node: KalamuNode): boolean {
  return node.kind !== "bullet" && node.text.trim() !== "";
}

/**
 * Progress for every node in the tree, keyed by id. One bottom-up pass — call
 * it once per outline change rather than once per row.
 */
export function progressByNode(tree: Tree): Map<string, Progress> {
  const out = new Map<string, Progress>();
  /** `closed` = a done ancestor task already finished everything below it. */
  const visit = (node: KalamuNode, closed: boolean): Progress => {
    const shut = closed || (node.kind === "task" && node.doneAt !== null);
    let total = 0;
    let done = 0;
    let active = 0;
    if (isActionable(node)) {
      total = 1;
      // A claim on a closed task is spent: closure wins, and a task can carry
      // both timestamps. Discussions are never claimed (no `kalamu start`).
      if (shut || node.doneAt !== null) done = 1;
      else if (node.kind === "task" && node.startedAt !== undefined) active = 1;
    }
    for (const child of tree.children.get(node.id) ?? []) {
      const sub = visit(child, shut);
      total += sub.total;
      done += sub.done;
      active += sub.active;
    }
    const result: Progress = { total, done, active };
    out.set(node.id, result);
    return result;
  };
  for (const root of tree.children.get(null) ?? []) visit(root, false);
  return out;
}

/** Progress for one subtree; `rootId: null` totals the whole outline. */
export function progressOf(tree: Tree, rootId: string | null): Progress {
  const all = progressByNode(tree);
  if (rootId !== null) return all.get(rootId) ?? { total: 0, done: 0, active: 0 };
  let total = 0;
  let done = 0;
  let active = 0;
  for (const root of tree.children.get(null) ?? []) {
    const p = all.get(root.id);
    if (!p) continue;
    total += p.total;
    done += p.done;
    active += p.active;
  }
  return { total, done, active };
}
