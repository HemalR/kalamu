import {
  buildTree,
  depthOf,
  effectivePriority,
  pathOf,
  preorder,
  type KalamuNode,
  type Tree,
} from "@kalamu/core";

export function glyphFor(node: KalamuNode): string {
  if (node.kind === "bullet") return "•";
  if (node.kind === "discussion") return node.doneAt !== null ? "✓" : "?";
  if (node.doneAt !== null) return "☑";
  // Claimed but not finished: visibly different from an open task, so a human
  // scanning `list` can see what an agent is already holding.
  return node.startedAt !== undefined ? "▶" : "☐";
}

/** Priority leads the row so priorities align in a scannable column. */
export function prefixFor(node: KalamuNode): string {
  if (node.kind !== "bullet" && effectivePriority(node) !== 3) return `p${effectivePriority(node)} `;
  return "";
}

export function suffixFor(node: KalamuNode): string {
  let out = "";
  if (node.assignee) out += ` @${node.assignee}`;
  if (node.blockedBy?.length) out += ` ⛔ ${node.blockedBy.join(" ")}`;
  return out;
}

/** Ancestor texts, root first, joined the way `next` prints Path. */
export function formatPath(tree: Tree, node: KalamuNode): string {
  return pathOf(tree, node).join(" > ");
}

export function renderLine(tree: Tree, node: KalamuNode, idWidth: number, indentLevels?: number): string {
  const indent = "  ".repeat(indentLevels ?? depthOf(tree, node));
  return `${node.id.padEnd(idWidth)}  ${indent}${glyphFor(node)} ${prefixFor(node)}${node.text}${suffixFor(node)}`;
}

/**
 * Indent follows the displayed tree, not the real one: a filtered view that
 * omits a parent would otherwise look nested under whichever row happened to
 * print above it. When the immediate parent is missing, the real ancestor
 * chain is printed as a Path line instead (same shape as `kalamu next`).
 */
export function renderOutline(nodes: readonly KalamuNode[], filter?: (node: KalamuNode) => boolean): string {
  const tree = buildTree(nodes);
  const ordered = preorder(tree).filter(filter ?? (() => true));
  if (!ordered.length) return "(empty)";
  const shown = new Set(ordered.map((n) => n.id));
  const idWidth = Math.max(...ordered.map((n) => n.id.length));
  return ordered
    .map((n) => {
      const line = renderLine(tree, n, idWidth, displayDepth(tree, n, shown));
      if (n.parentId === null || shown.has(n.parentId)) return line;
      const path = formatPath(tree, n);
      if (!path) return line;
      return `${line}\n${" ".repeat(idWidth + 2)}Path: ${path}`;
    })
    .join("\n");
}

/** How many shown ancestors sit above this node — 0 when the parent is omitted. */
function displayDepth(tree: Tree, node: KalamuNode, shown: Set<string>): number {
  let depth = 0;
  let current = node.parentId;
  while (current !== null) {
    if (shown.has(current)) depth++;
    current = tree.byId.get(current)?.parentId ?? null;
  }
  return depth;
}
