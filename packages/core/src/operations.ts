import { newId } from "./ids.js";
import { effectivePriority, TAG_PATTERN, type Assignee, type KalamuNode, type NodeKind } from "./model.js";
import { appendTags, stripTags } from "./tokens.js";
import { ancestors, buildTree, isDescendant, pathOf, preorder, subtreeIds, type Tree } from "./tree.js";

export class OperationError extends Error {}

function requireNode(tree: Tree, id: string): KalamuNode {
  const node = tree.byId.get(id);
  if (!node) throw new OperationError(`no node with id ${id}`);
  return node;
}

/** Every operation returns the full node list in canonical pre-order. */
function emit(tree: Tree): KalamuNode[] {
  return preorder(tree);
}

function insertAmongSiblings(
  siblings: KalamuNode[],
  node: KalamuNode,
  position: { afterId?: string | undefined; beforeId?: string | undefined },
): KalamuNode[] {
  if (position.afterId !== undefined) {
    const index = siblings.findIndex((s) => s.id === position.afterId);
    if (index === -1) throw new OperationError(`--after ${position.afterId} is not a sibling under the target parent`);
    return [...siblings.slice(0, index + 1), node, ...siblings.slice(index + 1)];
  }
  if (position.beforeId !== undefined) {
    const index = siblings.findIndex((s) => s.id === position.beforeId);
    if (index === -1) throw new OperationError(`--before ${position.beforeId} is not a sibling under the target parent`);
    return [...siblings.slice(0, index), node, ...siblings.slice(index)];
  }
  return [...siblings, node];
}

export interface AddInput {
  parentId?: string | undefined;
  kind?: NodeKind | undefined;
  text: string;
  priority?: 1 | 2 | 3 | 4 | 5 | undefined;
  tags?: string[] | undefined;
  assignee?: Assignee | undefined;
  afterId?: string | undefined;
  beforeId?: string | undefined;
  now?: string | undefined;
}

export function addNode(nodes: readonly KalamuNode[], input: AddInput): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const parentId = input.parentId ?? null;
  if (parentId !== null) requireNode(tree, parentId);

  const node: KalamuNode = {
    id: newId(new Set(tree.byId.keys())),
    parentId,
    kind: input.kind ?? "bullet",
    // Tags live inline in text: --tag appends the #token (SPEC key decision 7).
    text: input.tags?.length ? appendTags(input.text, validTags(input.tags)) : input.text,
    createdAt: input.now ?? new Date().toISOString(),
    doneAt: null,
    handoff: null,
  };
  // Missing priority means default (p3); never store the default.
  if (input.priority !== undefined && input.priority !== 3) node.priority = input.priority;
  if (input.assignee !== undefined) {
    if (node.kind === "discussion") {
      throw new OperationError("discussions involve both parties; only tasks can be assigned");
    }
    node.assignee = input.assignee;
  }
  // A priority marks actionable work: it makes the node a task unless the
  // caller explicitly chose a kind.
  if (node.priority !== undefined && input.kind === undefined) node.kind = "task";

  const siblings = tree.children.get(parentId) ?? [];
  tree.children.set(parentId, insertAmongSiblings(siblings, node, input));
  tree.byId.set(node.id, node);
  return { nodes: emit(tree), node };
}

function validTags(tags: readonly string[]): string[] {
  return tags.map((raw) => {
    const tag = raw.toLowerCase();
    if (!TAG_PATTERN.test(tag)) {
      throw new OperationError(`invalid tag "${raw}" — lowercase letters, digits, and dashes only`);
    }
    return tag;
  });
}

export interface UpdateInput {
  text?: string | undefined;
  kind?: NodeKind | undefined;
  priority?: 1 | 2 | 3 | 4 | 5 | "default" | undefined;
  addTags?: string[] | undefined;
  removeTags?: string[] | undefined;
  /** "human" | "agent" assigns; null clears back to unassigned. */
  assignee?: Assignee | null | undefined;
}

export function updateNode(nodes: readonly KalamuNode[], id: string, input: UpdateInput): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const node = requireNode(tree, id);
  const updated: KalamuNode = { ...node };

  if (input.text !== undefined) updated.text = input.text;
  // Converting away from task preserves doneAt/handoff/priority/assignee:
  // inert on other kinds, restored if converted back (SPEC "kalamu update").
  if (input.kind !== undefined) updated.kind = input.kind;
  if (input.priority !== undefined) {
    if (input.priority === "default" || input.priority === 3) delete updated.priority;
    else {
      updated.priority = input.priority;
      // Setting a real priority converts a bullet into a task; an explicit
      // kind in the same update wins, and discussions keep their kind
      // (priority orders them without making them agent work).
      if (input.kind === undefined && updated.kind === "bullet") updated.kind = "task";
    }
  }
  // Tag add/remove is text surgery: tags are inline #tokens (key decision 7).
  if (input.removeTags?.length) updated.text = stripTags(updated.text, input.removeTags);
  if (input.addTags?.length) updated.text = appendTags(updated.text, validTags(input.addTags));
  if (input.assignee !== undefined) {
    if (input.assignee === null) delete updated.assignee;
    else if (updated.kind === "discussion") {
      throw new OperationError("discussions involve both parties; only tasks can be assigned");
    } else updated.assignee = input.assignee;
  }

  return replace(tree, updated);
}

function replace(tree: Tree, updated: KalamuNode): { nodes: KalamuNode[]; node: KalamuNode } {
  tree.byId.set(updated.id, updated);
  const siblings = tree.children.get(updated.parentId) ?? [];
  tree.children.set(
    updated.parentId,
    siblings.map((s) => (s.id === updated.id ? updated : s)),
  );
  return { nodes: emit(tree), node: updated };
}

export interface MoveInput {
  parentId?: string | null | undefined;
  afterId?: string | undefined;
  beforeId?: string | undefined;
}

export function moveNode(nodes: readonly KalamuNode[], id: string, input: MoveInput): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const node = requireNode(tree, id);
  const targetParentId = input.parentId === undefined ? node.parentId : input.parentId;

  if (targetParentId === id) throw new OperationError("cannot move a node under itself");
  if (targetParentId !== null) {
    requireNode(tree, targetParentId);
    if (isDescendant(tree, targetParentId, id)) {
      throw new OperationError("cannot move a node under its own descendant");
    }
  }
  if (input.afterId === id || input.beforeId === id) {
    throw new OperationError("cannot position a node relative to itself");
  }

  const oldSiblings = tree.children.get(node.parentId) ?? [];
  tree.children.set(node.parentId, oldSiblings.filter((s) => s.id !== id));

  const moved: KalamuNode = { ...node, parentId: targetParentId };
  tree.byId.set(id, moved);
  const newSiblings = tree.children.get(targetParentId) ?? [];
  tree.children.set(targetParentId, insertAmongSiblings(newSiblings, moved, input));
  return { nodes: emit(tree), node: moved };
}

export function deleteNode(nodes: readonly KalamuNode[], id: string, options: { recursive?: boolean | undefined } = {}): { nodes: KalamuNode[]; deletedCount: number } {
  const tree = buildTree(nodes);
  requireNode(tree, id);
  const doomed = subtreeIds(tree, id);
  if (doomed.size > 1 && !options.recursive) {
    throw new OperationError(`node ${id} has ${doomed.size - 1} descendant(s); pass --recursive to delete the subtree`);
  }
  const remaining = preorder(tree).filter((n) => !doomed.has(n.id));
  return { nodes: remaining, deletedCount: doomed.size };
}

// Done on a BULLET is strikethrough plus cleanup: it never affects
// next/eligibility or umbrella closing, but cleanDone removes it once
// nothing beneath it survives (SPEC "done").
export function markDone(nodes: readonly KalamuNode[], id: string, now?: string): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const node = requireNode(tree, id);
  return replace(tree, { ...node, doneAt: now ?? new Date().toISOString() });
}

export function reopen(nodes: readonly KalamuNode[], id: string): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const node = requireNode(tree, id);
  return replace(tree, { ...node, doneAt: null });
}

export function setHandoff(nodes: readonly KalamuNode[], id: string, target: string, ref: string, now?: string): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const node = requireNode(tree, id);
  if (node.kind !== "task") throw new OperationError(`${id} is a ${node.kind}; only tasks can be handed off`);
  return replace(tree, { ...node, handoff: { at: now ?? new Date().toISOString(), target, ref } });
}

export function clearHandoff(nodes: readonly KalamuNode[], id: string): { nodes: KalamuNode[]; node: KalamuNode } {
  const tree = buildTree(nodes);
  const node = requireNode(tree, id);
  if (node.kind !== "task") throw new OperationError(`${id} is a ${node.kind}; only tasks can be handed off`);
  if (node.handoff === null) throw new OperationError(`${id} has no handoff to clear`);
  return replace(tree, { ...node, handoff: null });
}

export interface NextResult {
  node: KalamuNode;
  path: string[];
  reason: string;
}

export interface NextOptions {
  /** Only consider nodes inside this node's subtree (the node itself included). */
  under?: string;
  /** Keep tasks whose own or ancestor handoff is set (done exclusions still apply). */
  includeHandedOff?: boolean;
  /** Which queue to draw from; default "task" (the agent work queue). */
  kind?: "task" | "discussion";
}

/**
 * The full queue for one kind (default: the agent task queue). Eligibility:
 * open node of that kind with non-blank text and no done/handed-off ancestor
 * TASK (a closed parent task closes its umbrella; bullets and discussions
 * never affect eligibility). Tasks must additionally be unhanded-off and not
 * assigned to the human; on discussions handoff/assignee are inert leftovers
 * from a past life as a task and never gate. Sort: priority ascending (p1
 * first, missing = p3), then outline order. Sort is stable, so outline order
 * is the tie-breaker for free.
 */
export function eligibleTasks(
  nodes: readonly KalamuNode[],
  options: NextOptions = {},
): { node: KalamuNode; path: string[] }[] {
  const tree = buildTree(nodes);
  const kind = options.kind ?? "task";
  const scope = options.under !== undefined ? subtreeIds(tree, requireNode(tree, options.under).id) : null;
  const handedOffCounts = options.includeHandedOff !== true;
  return preorder(tree)
    .filter(
      (n) =>
        n.kind === kind &&
        n.text.trim() !== "" &&
        n.doneAt === null &&
        (kind === "discussion" ||
          ((!handedOffCounts || n.handoff === null) && n.assignee !== "human")) &&
        (scope === null || scope.has(n.id)) &&
        !ancestors(tree, n).some(
          (a) => a.kind === "task" && (a.doneAt !== null || (handedOffCounts && a.handoff !== null)),
        ),
    )
    .sort((a, b) => effectivePriority(a) - effectivePriority(b))
    .map((node) => ({ node, path: pathOf(tree, node) }));
}

export function nextTask(nodes: readonly KalamuNode[], options: NextOptions = {}): NextResult | null {
  const queue = eligibleTasks(nodes, options);
  const first = queue[0];
  if (!first) return null;
  const ties = queue.filter((e) => effectivePriority(e.node) === effectivePriority(first.node));
  const what = `highest-priority open ${options.kind ?? "task"}`;
  const reason = ties.length > 1 ? `${what}; tie-breaker: outline order` : what;
  return { ...first, reason };
}

export interface CleanResult {
  nodes: KalamuNode[];
  removed: KalamuNode[];
  doneTasks: number;
  doneBullets: number;
  doneDiscussions: number;
  blankNodes: number;
}

/**
 * Remove every done task together with its subtree (a done parent closes its
 * umbrella — key decision 4), plus done bullets, done discussions, and blank
 * (whitespace-only text) nodes. Handed-off-but-open tasks stay. Done
 * bullets/discussions and blank nodes never take surviving children with
 * them: neither closes its subtree (a done discussion's children are its
 * recorded outcome) and a blank node is structural, so each stays while
 * anything beneath it survives.
 */
export function cleanDone(nodes: readonly KalamuNode[]): CleanResult {
  const tree = buildTree(nodes);
  const doomed = new Set<string>();
  let doneTasks = 0;
  for (const node of tree.byId.values()) {
    if (node.kind === "task" && node.doneAt !== null) {
      doneTasks += 1;
      for (const id of subtreeIds(tree, node.id)) doomed.add(id);
    }
  }
  const ordered = preorder(tree);
  let doneBullets = 0;
  let doneDiscussions = 0;
  let blankNodes = 0;
  // Reverse pre-order visits every child before its parent, so a chain of
  // removable nodes collapses in one pass.
  for (let i = ordered.length - 1; i >= 0; i--) {
    const node = ordered[i]!;
    if (doomed.has(node.id)) continue;
    const doneNonTask = node.kind !== "task" && node.doneAt !== null;
    if (!doneNonTask && node.text.trim() !== "") continue;
    const children = tree.children.get(node.id) ?? [];
    if (!children.every((c) => doomed.has(c.id))) continue;
    doomed.add(node.id);
    if (!doneNonTask) blankNodes += 1;
    else if (node.kind === "discussion") doneDiscussions += 1;
    else doneBullets += 1;
  }
  return {
    nodes: ordered.filter((n) => !doomed.has(n.id)),
    removed: ordered.filter((n) => doomed.has(n.id)),
    doneTasks,
    doneBullets,
    doneDiscussions,
    blankNodes,
  };
}

export function searchNodes(nodes: readonly KalamuNode[], query: string): KalamuNode[] {
  const tree = buildTree(nodes);
  const needle = query.toLowerCase();
  return preorder(tree).filter((n) => n.text.toLowerCase().includes(needle));
}
