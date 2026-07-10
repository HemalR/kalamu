import { z } from "zod";

export type NodeKind = "bullet" | "task";

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
  priority?: 1 | 2 | 3 | 4 | 5;
  self?: true;
}
// No tags field: a tag IS its inline #token in text; the set is derived
// (SPEC key decision 7). No collapsed field: view state (key decision 10).

export const DEFAULT_PRIORITY = 3;

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

export const nodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  kind: z.enum(["bullet", "task"]),
  text: z.string(),
  createdAt: isoTimestamp,
  doneAt: isoTimestamp.nullable(),
  handoff: handoffSchema.nullable(),
  priority: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
  self: z.literal(true).optional(),
}) satisfies z.ZodType<KalamuNode>;

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
}

export const uiStateSchema = z.object({
  collapsed: z.array(z.string()),
}) satisfies z.ZodType<UiState>;

export function effectivePriority(node: KalamuNode): number {
  return node.priority ?? DEFAULT_PRIORITY;
}

export function isOpenTask(node: KalamuNode): boolean {
  return node.kind === "task" && node.doneAt === null;
}
