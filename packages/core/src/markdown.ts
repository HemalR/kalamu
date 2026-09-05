/**
 * Markdown serialization of outline subtrees — the single source of truth
 * for the CLI (`show --format markdown`) and outline-shaped text embedded in
 * web clipboard prompts. Two-space indent per depth; roots at depth 0.
 */
import { effectivePriority, type KalamuNode } from "./model.js";
import type { Tree } from "./tree.js";

export function markdownLine(node: KalamuNode): string {
  const box =
    node.kind === "bullet" ? "-"
    : node.kind === "discussion" ? (node.doneAt !== null ? "- [x?]" : "- [?]")
    : node.doneAt !== null ? "- [x]" : "- [ ]";
  const priority =
    node.kind !== "bullet" && effectivePriority(node) !== 2 ? `p${effectivePriority(node)} ` : "";
  let suffix = "";
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

/**
 * GitHub-style heading slug: lowercase, punctuation dropped, spaces to
 * hyphens. The anchor form of `plans/foo.md#slug` (SPEC key decision 19), so
 * the same text gives the same slug on the doc page and in the reference.
 */
export function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export interface MarkdownHeading {
  level: number;
  text: string;
  slug: string;
  /** Zero-based line index in the source. */
  line: number;
}

/** ATX headings (`## Title`) of a Markdown source, in order; fenced code is skipped. */
export function markdownHeadings(source: string): MarkdownHeading[] {
  const out: MarkdownHeading[] = [];
  let inFence = false;
  source.split("\n").forEach((raw, line) => {
    if (/^\s*(```|~~~)/.test(raw)) inFence = !inFence;
    if (inFence) return;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out.push({ level: match[1].length, text: match[2], slug: headingSlug(match[2]), line });
    }
  });
  return out;
}
