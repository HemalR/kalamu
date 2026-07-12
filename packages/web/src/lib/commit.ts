/**
 * Pure token-commit logic (SPEC "Priority parsing in UI", "Tags").
 *
 * pN and @human/@agent are metadata: extracted and stripped on commit. #tags
 * are prose (SPEC key decision 7): they stay in the text verbatim and are only
 * rendered as chips. Kept free of runes/DOM so the delta rules — especially "a
 * typed priority token OVERRIDES the stored priority" — are unit-testable.
 */
import { parseTokens, type KalamuNode, type ParsedTokens } from "@kalamu/core";
import type { PatchNodeBody } from "./api";

export type CommitPatch = Pick<PatchNodeBody, "text" | "priority" | "assignee">;

/** Full commit of edited text: extract pN/@human/@agent, diff against the node. Null = nothing to do. */
export function commitPatch(node: KalamuNode, raw: string): CommitPatch | null {
  const parsed = parseTokens(raw);
  const patch = tokenPatch(node, parsed);
  if (parsed.text !== node.text) patch.text = parsed.text;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Patch for extracted tokens only (used by parse-on-space, where the editor
 * handles the text itself). Rules:
 * - a priority token always overrides the stored priority; `p3` clears it
 *   back to default (stored priority removed) — on any kind, since core's
 *   updateNode converts only bullets (a discussion stays a discussion)
 * - `@human`/`@agent` sets the assignee on tasks only (dropped on bullets
 *   and discussions — discussions are never assigned)
 * - #tags are NOT metadata — they live in the text and never patch anything
 */
export function tokenPatch(node: KalamuNode, parsed: ParsedTokens): CommitPatch {
  const patch: CommitPatch = {};
  if (parsed.priority !== undefined) {
    const target = parsed.priority === 3 ? undefined : parsed.priority;
    if (target !== node.priority) patch.priority = target ?? "default";
  }
  if (parsed.assignee !== undefined && node.kind === "task" && node.assignee !== parsed.assignee) {
    patch.assignee = parsed.assignee;
  }
  return patch;
}

/**
 * The word immediately before `offset` in `text`, if it is a single complete
 * pN/@human/@agent token. #tags deliberately do not match — they stay in the
 * text and become chips on blur. Never re-scans the rest of the text.
 */
export function tokenBeforeCaret(
  text: string,
  offset: number,
): { parsed: ParsedTokens; start: number } | null {
  const match = /(?:^|\s)(\S+)$/.exec(text.slice(0, offset));
  const word = match?.[1];
  if (word === undefined) return null;
  const parsed = parseTokens(word);
  const isToken = parsed.text === "" && (parsed.priority !== undefined || parsed.assignee !== undefined);
  return isToken ? { parsed, start: offset - word.length } : null;
}
