import type { KalamuNode } from "./model.js";

export interface Tree {
  byId: Map<string, KalamuNode>;
  /** Children in sibling order; key null-parent under ROOT_KEY. */
  children: Map<string | null, KalamuNode[]>;
}

/**
 * Sibling order = relative line order (lenient: interleaved subtrees still
 * parse deterministically). Nodes with a missing parent or on a cycle are
 * excluded from the tree; callers that need to report them use validate().
 */
export function buildTree(nodes: readonly KalamuNode[]): Tree {
  const byId = new Map<string, KalamuNode>();
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }
  const children = new Map<string | null, KalamuNode[]>();
  for (const node of byId.values()) {
    if (node.parentId !== null && !byId.has(node.parentId)) continue;
    if (node.parentId !== null && onCycle(node, byId)) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  return { byId, children };
}

function onCycle(node: KalamuNode, byId: Map<string, KalamuNode>): boolean {
  const seen = new Set<string>([node.id]);
  let current = node.parentId;
  while (current !== null) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/** Canonical outline order: pre-order traversal. This is the writer's line order. */
export function preorder(tree: Tree): KalamuNode[] {
  const out: KalamuNode[] = [];
  const visit = (parentId: string | null): void => {
    for (const child of tree.children.get(parentId) ?? []) {
      out.push(child);
      visit(child.id);
    }
  };
  visit(null);
  return out;
}

export function ancestors(tree: Tree, node: KalamuNode): KalamuNode[] {
  const out: KalamuNode[] = [];
  let current = node.parentId;
  while (current !== null) {
    const parent = tree.byId.get(current);
    if (!parent) break;
    out.push(parent);
    current = parent.parentId;
  }
  return out.reverse();
}

/** Ancestor texts from root to immediate parent. */
export function pathOf(tree: Tree, node: KalamuNode): string[] {
  return ancestors(tree, node).map((n) => n.text);
}

export function isDescendant(tree: Tree, candidateId: string, ancestorId: string): boolean {
  let current = tree.byId.get(candidateId)?.parentId ?? null;
  while (current !== null) {
    if (current === ancestorId) return true;
    current = tree.byId.get(current)?.parentId ?? null;
  }
  return false;
}

export function subtreeIds(tree: Tree, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  const visit = (id: string): void => {
    for (const child of tree.children.get(id) ?? []) {
      out.add(child.id);
      visit(child.id);
    }
  };
  visit(rootId);
  return out;
}

export function depthOf(tree: Tree, node: KalamuNode): number {
  return ancestors(tree, node).length;
}
