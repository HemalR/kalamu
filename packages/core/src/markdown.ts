/**
 * Markdown serialization of outline subtrees — the single source of truth
 * for the format shared by the CLI (`show --format markdown`) and the web
 * UI's copy-subtree (Cmd+C). Two-space indent per depth; roots at depth 0.
 */
import { effectivePriority, type KalamuNode } from "./model.js";
import type { Tree } from "./tree.js";

export function markdownLine(node: KalamuNode): string {
  const box = node.kind === "bullet" ? "-" : node.doneAt !== null ? "- [x]" : "- [ ]";
  const priority =
    node.kind === "task" && effectivePriority(node) !== 3 ? `p${effectivePriority(node)} ` : "";
  let suffix = "";
  if (node.handoff) suffix += ` → ${node.handoff.target}:${node.handoff.ref}`;
  if (node.assignee) suffix += ` @${node.assignee}`;
  return `${box} ${priority}${node.text}${suffix}`;
}

/** maxDepth counts levels below each root; undefined means the whole subtree. */
export function serializeMarkdown(tree: Tree, roots: readonly KalamuNode[], maxDepth?: number): string {
  const lines: string[] = [];
  const visit = (node: KalamuNode, depth: number): void => {
    lines.push(`${"  ".repeat(depth)}${markdownLine(node)}`);
    if (maxDepth !== undefined && depth + 1 > maxDepth) return;
    for (const child of tree.children.get(node.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  return lines.join("\n");
}
