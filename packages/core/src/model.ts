import { z } from "zod";

// "discussion" is a work item whose deliverable is a conversation between the
// developer and an agent: never eligible for `next`, never assignable
// (it involves both parties by definition), priority allowed for ordering.
export type NodeKind = "bullet" | "task" | "discussion";

/** Audience, not users: the developer at the keyboard or their agents. */
export type Assignee = "human" | "agent";

export interface Handoff {
  at: string;
  target: string;
  ref: string;
}

export interface KalamuNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  text: string;
  createdAt: string;
  doneAt: string | null;
  handoff: Handoff | null;
  /** 1 = high, 2 = medium (the default — never persisted), 3 = low. */
  priority?: 1 | 2 | 3;
  assignee?: Assignee;
}
// No tags field: a tag IS its inline #token in text; the set is derived
// (SPEC key decision 7). No collapsed field: view state (key decision 10).

export const DEFAULT_PRIORITY = 2;

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const isoTimestamp = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "must be a valid ISO timestamp" },
);

export const handoffSchema = z.object({
  at: isoTimestamp,
  target: z.string().min(1),
  ref: z.string().min(1),
});

// Passthrough: fields this build doesn't know (written by a newer CLI/server)
// must survive parse → operate → write, so a stale process can never erase
// them (2026-07-10: a pre-assignee server's whole-outline PUT dropped assignee).
export const nodeSchema = z
  .object({
    id: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    kind: z.enum(["bullet", "task", "discussion"]),
    text: z.string(),
    createdAt: isoTimestamp,
    doneAt: isoTimestamp.nullable(),
    handoff: handoffSchema.nullable(),
    priority: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .optional(),
    assignee: z.enum(["human", "agent"]).optional(),
  })
  .passthrough() satisfies z.ZodType<KalamuNode>;

export interface KalamuMeta {
  version: number;
  tags?: Record<string, string>;
}

export const metaSchema = z.object({
  version: z.number().int().min(1),
  tags: z.record(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
}) satisfies z.ZodType<KalamuMeta>;

export interface UiState {
  collapsed: string[];
  /** Hide completed nodes in the UI; omitted means false. */
  hideDone?: boolean;
}

export const uiStateSchema = z.object({
  collapsed: z.array(z.string()),
  hideDone: z.boolean().optional(),
}) satisfies z.ZodType<UiState>;

export function effectivePriority(node: KalamuNode): number {
  return node.priority ?? DEFAULT_PRIORITY;
}

export function isOpenTask(node: KalamuNode): boolean {
  return node.kind === "task" && node.doneAt === null;
}
