import { z } from "zod";

// "discussion" is a work item whose deliverable is a conversation between the
// developer and an agent: never eligible for `next`, never assignable
// (it involves both parties by definition), priority allowed for ordering.
export type NodeKind = "bullet" | "task" | "discussion";

/** Audience, not users: the developer at the keyboard or their agents. */
export type Assignee = "human" | "agent";

export interface KalamuNode {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  text: string;
  createdAt: string;
  doneAt: string | null;
  /**
   * When an agent claimed this task (SPEC key decision 17). Set with `start`,
   * cleared with `end`; present with a null `doneAt` means in progress. A
   * claimed task is skipped by `next` so a second session cannot take work
   * already underway. A timestamp rather than a status for the same reason
   * `doneAt` is not a boolean.
   */
  startedAt?: string;
  /** 1 = high, 2 = medium (the default — never persisted), 3 = low. */
  priority?: 1 | 2 | 3;
  assignee?: Assignee;
  /**
   * Who authored the node (SPEC key decision 15). Only ever `"agent"` — human
   * authorship is the default and is never persisted. `assignee` cannot carry
   * this: a task the human delegated and one the agent invented for itself are
   * both `assignee: "agent"`, but only the second should be hideable while the
   * human is thinking.
   */
  createdBy?: "agent";
  /**
   * Ids of nodes this task waits on (SPEC key decision 16). One direction
   * only — there is no reverse `blocks` array, because two directions must be
   * kept in sync and drift. Omitted rather than stored as an empty array.
   */
  blockedBy?: string[];
}
// No tags field: a tag IS its inline #token in text; the set is derived
// (SPEC key decision 7). No collapsed field: view state (key decision 10).

export const DEFAULT_PRIORITY = 2;

export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const isoTimestamp = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)),
  { message: "must be a valid ISO timestamp" },
);

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
    startedAt: isoTimestamp.optional(),
    priority: z
      .union([z.literal(1), z.literal(2), z.literal(3)])
      .optional(),
    assignee: z.enum(["human", "agent"]).optional(),
    createdBy: z.literal("agent").optional(),
    blockedBy: z
      .array(z.string().min(1))
      .nonempty({ message: "must not be empty — omit the field instead" })
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "must not repeat the same blocker",
      })
      .optional(),
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

/**
 * Which authors/assignees the outline shows. An absent axis means "show all";
 * an axis lists exactly the values that stay visible. `"unassigned"` is its own
 * assignee value because most nodes carry no assignee at all, and folding them
 * into either side would make them vanish the moment a filter is switched on.
 */
export interface OutlineFilters {
  createdBy?: Assignee[];
  assignee?: (Assignee | "unassigned")[];
}

export interface UiState {
  collapsed: string[];
  /** Hide completed nodes in the UI; omitted means false. */
  hideDone?: boolean;
  /** Compact mode: rows show a derived one-glance label; omitted means false. */
  compact?: boolean;
  /** Author/assignee filters; omitted means unfiltered (SPEC key decision 15). */
  filters?: OutlineFilters;
}

export const outlineFiltersSchema = z.object({
  createdBy: z.array(z.enum(["human", "agent"])).optional(),
  assignee: z.array(z.enum(["human", "agent", "unassigned"])).optional(),
}) satisfies z.ZodType<OutlineFilters>;

export const uiStateSchema = z.object({
  collapsed: z.array(z.string()),
  hideDone: z.boolean().optional(),
  compact: z.boolean().optional(),
  filters: outlineFiltersSchema.optional(),
}) satisfies z.ZodType<UiState>;

export function effectivePriority(node: KalamuNode): number {
  return node.priority ?? DEFAULT_PRIORITY;
}

export function isOpenTask(node: KalamuNode): boolean {
  return node.kind === "task" && node.doneAt === null;
}
