import {
  buildTree,
  depthOf,
  effectivePriority,
  preorder,
  type KalamuNode,
  type Tree,
} from "@kalamu/core";

export function glyphFor(node: KalamuNode): string {
  if (node.kind === "bullet") return "•";
  if (node.kind === "discussion") return node.doneAt !== null ? "✓" : "?";
  return node.doneAt !== null ? "☑" : "☐";
}

/** Priority leads the row so priorities align in a scannable column. */
export function prefixFor(node: KalamuNode): string {
  if (node.kind !== "bullet" && effectivePriority(node) !== 3) return `p${effectivePriority(node)} `;
  return "";
}

export function suffixFor(node: KalamuNode): string {
  let out = "";
  if (node.handoff) out += ` → ${node.handoff.target}:${node.handoff.ref}`;
  if (node.assignee) out += ` @${node.assignee}`;
  return out;
}

export function renderLine(tree: Tree, node: KalamuNode, idWidth: number): string {
  const indent = "  ".repeat(depthOf(tree, node));
  return `${node.id.padEnd(idWidth)}  ${indent}${glyphFor(node)} ${prefixFor(node)}${node.text}${suffixFor(node)}`;
}

/** Outline listing: pre-order, indentation from real depth even when filtered. */
export function renderOutline(nodes: readonly KalamuNode[], filter?: (node: KalamuNode) => boolean): string {
  const tree = buildTree(nodes);
  const ordered = preorder(tree).filter(filter ?? (() => true));
  if (!ordered.length) return "(empty)";
  const idWidth = Math.max(...ordered.map((n) => n.id.length));
  return ordered.map((n) => renderLine(tree, n, idWidth)).join("\n");
}

