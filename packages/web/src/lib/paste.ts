/**
 * Multi-line paste into an empty node: each non-empty line becomes its own
 * sibling, inheriting the target's kind. Pure so the split and the outline
 * rewrite are unit-testable without the store or the DOM.
 */
import {
  addNode,
  parseTokens,
  updateNode,
  type Assignee,
  type KalamuNode,
  type NodeKind,
} from "@kalamu/core";
import { commitPatch } from "./commit";

/** Two or more non-empty lines, else null — a single line pastes natively. */
export function splitPasteLines(text: string): string[] | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length >= 2 ? lines : null;
}

/** addNode fields for one pasted line: tokens extracted, kind never converted. */
export function pastedLineFields(
  kind: NodeKind,
  raw: string,
): { text: string; priority?: 1 | 3; assignee?: Assignee } {
  const parsed = parseTokens(raw);
  const fields: { text: string; priority?: 1 | 3; assignee?: Assignee } = { text: parsed.text };
  if (parsed.priority === 1 || parsed.priority === 3) fields.priority = parsed.priority;
  if (parsed.assignee !== undefined && kind === "task") fields.assignee = parsed.assignee;
  return fields;
}

export interface PasteExtraPosition {
  /** Parent of the extra lines; null = top-level siblings of a root target. */
  parentId: string | null;
  afterId?: string;
  beforeId?: string;
  now?: string;
}

/**
 * Fill `id` with `lines[0]` (token-parsed, kind preserved) and insert the rest
 * as new nodes of the same kind. `extra` places the first extra line; each
 * subsequent extra is inserted after the previous. One outline rewrite.
 */
export function applyPasteLines(
  nodes: readonly KalamuNode[],
  id: string,
  lines: readonly string[],
  extra: PasteExtraPosition,
): { nodes: KalamuNode[]; lastId: string; createdIds: string[] } {
  const first = lines[0];
  if (first === undefined) return { nodes: [...nodes], lastId: id, createdIds: [] };
  const node = nodes.find((n) => n.id === id);
  if (!node) return { nodes: [...nodes], lastId: id, createdIds: [] };

  const patch = commitPatch(node, first);
  // Pass kind so a pN token cannot convert a bullet into a task — the paste
  // target's kind is the kind of every line.
  let next = patch ? updateNode(nodes, id, { ...patch, kind: node.kind }).nodes : [...nodes];
  let lastId = id;
  const createdIds: string[] = [];
  let position: { afterId?: string; beforeId?: string } = {
    ...(extra.afterId === undefined ? {} : { afterId: extra.afterId }),
    ...(extra.beforeId === undefined ? {} : { beforeId: extra.beforeId }),
  };

  for (const line of lines.slice(1)) {
    const added = addNode(next, {
      ...(extra.parentId === null ? {} : { parentId: extra.parentId }),
      kind: node.kind,
      ...pastedLineFields(node.kind, line),
      ...position,
      now: extra.now,
    });
    next = added.nodes;
    lastId = added.node.id;
    createdIds.push(lastId);
    position = { afterId: lastId };
  }
  return { nodes: next, lastId, createdIds };
}
