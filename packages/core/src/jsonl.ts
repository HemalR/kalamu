import { z } from "zod";
import { nodeSchema, TAG_PATTERN, type KalamuNode } from "./model.js";
import { appendTags } from "./tokens.js";

/**
 * Legacy fields readers still accept (and rewrite on the next write): a
 * `tags` array from before tags moved inline (SPEC key decision 7) merges
 * into the text as trailing #tokens; `self: true` from before assignment
 * (key decision 8) reads as `assignee: "human"`.
 */
const legacyLineSchema = nodeSchema.extend({
  tags: z.array(z.string()).optional(),
  self: z.literal(true).optional(),
});

function normalizeLegacy(raw: z.infer<typeof legacyLineSchema>): KalamuNode {
  const { tags, self, ...node } = raw;
  if (self && node.assignee === undefined) node.assignee = "human";
  if (!tags?.length) return node;
  const valid = tags.map((t) => t.toLowerCase()).filter((t) => TAG_PATTERN.test(t));
  return { ...node, text: appendTags(node.text, valid) };
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  nodes: KalamuNode[];
  errors: ParseError[];
}

/**
 * Lenient parse: every well-formed line becomes a node in file order;
 * malformed lines are reported, not fatal. Sibling order is the relative
 * order in which siblings appear, wherever their lines sit.
 */
export function parseJsonl(content: string): ParseResult {
  const nodes: KalamuNode[] = [];
  const errors: ParseError[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      errors.push({ line: i + 1, message: `invalid JSON: ${(err as Error).message}` });
      continue;
    }
    const parsed = legacyLineSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.length ? ` at "${issue.path.join(".")}"` : "";
      errors.push({ line: i + 1, message: `${issue?.message ?? "invalid node"}${where}` });
      continue;
    }
    nodes.push(normalizeLegacy(parsed.data));
  }
  return { nodes, errors };
}

/** Stable key order so unchanged nodes serialize byte-identically across writes. */
export function serializeNode(node: KalamuNode): string {
  const { id, parentId, kind, text, createdAt, doneAt, handoff, priority, assignee, ...extras } = node;
  const ordered: Record<string, unknown> = { id, parentId, kind, text, createdAt, doneAt, handoff };
  if (priority !== undefined) ordered["priority"] = priority;
  if (assignee !== undefined) ordered["assignee"] = assignee;
  // Fields from a newer build ride along after the known keys, sorted for stable output.
  for (const key of Object.keys(extras).sort()) {
    ordered[key] = (extras as Record<string, unknown>)[key];
  }
  return JSON.stringify(ordered);
}

export function serializeJsonl(nodes: readonly KalamuNode[]): string {
  return nodes.map(serializeNode).join("\n") + (nodes.length ? "\n" : "");
}
