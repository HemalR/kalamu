import { z } from "zod";
import { nodeSchema, TAG_PATTERN, type KalamuNode } from "./model.js";
import { appendTags } from "./tokens.js";

/**
 * Legacy fields readers still accept (and rewrite on the next write): a
 * `tags` array from before tags moved inline (SPEC key decision 7) merges
 * into the text as trailing #tokens; `self: true` from before assignment
 * (key decision 8) reads as `assignee: "human"`; priority 4/5 from the old
 * five-level scale reads as 3 (low); `handoff` from before it was removed
 * (key decision 18) merges into the text as the same `→ target:ref` suffix
 * the CLI and Markdown export used to render, so upgrading never silently
 * discards where a task went. A null handoff carried no information and is
 * simply dropped.
 */
const legacyLineSchema = nodeSchema.extend({
  tags: z.array(z.string()).optional(),
  self: z.literal(true).optional(),
  priority: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
  handoff: z
    .object({ at: z.string(), target: z.string(), ref: z.string() })
    .nullable()
    .optional(),
});

function normalizeLegacy(raw: z.infer<typeof legacyLineSchema>): KalamuNode {
  const { tags, self, priority, handoff, ...node } = raw;
  const out: KalamuNode = node;
  if (priority !== undefined) out.priority = priority === 4 || priority === 5 ? 3 : priority;
  if (self && out.assignee === undefined) out.assignee = "human";
  if (handoff) out.text = `${out.text} → ${handoff.target}:${handoff.ref}`;
  if (!tags?.length) return out;
  const valid = tags.map((t) => t.toLowerCase()).filter((t) => TAG_PATTERN.test(t));
  return { ...out, text: appendTags(out.text, valid) };
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
  const { id, parentId, kind, text, createdAt, doneAt, startedAt, priority, assignee, createdBy, blockedBy, ...extras } =
    node;
  const ordered: Record<string, unknown> = { id, parentId, kind, text, createdAt, doneAt };
  if (startedAt !== undefined) ordered["startedAt"] = startedAt;
  if (priority !== undefined) ordered["priority"] = priority;
  if (assignee !== undefined) ordered["assignee"] = assignee;
  if (createdBy !== undefined) ordered["createdBy"] = createdBy;
  // Never written as [] — an empty blocker list is an absent field.
  if (blockedBy?.length) ordered["blockedBy"] = blockedBy;
  // Fields from a newer build ride along after the known keys, sorted for stable output.
  for (const key of Object.keys(extras).sort()) {
    ordered[key] = (extras as Record<string, unknown>)[key];
  }
  return JSON.stringify(ordered);
}

export function serializeJsonl(nodes: readonly KalamuNode[]): string {
  return nodes.map(serializeNode).join("\n") + (nodes.length ? "\n" : "");
}
