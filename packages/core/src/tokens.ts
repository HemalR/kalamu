/**
 * Inline token handling (SPEC "Priority parsing in UI", "Tags").
 *
 * pN and @human/@agent are metadata, not prose: they are extracted and
 * STRIPPED from text. #tags are prose (SPEC key decision 7): they stay in the
 * text and the tag set is DERIVED by scanning for whole-word tokens.
 * Conservative by design: whole tokens only, never inside longer words.
 */

import type { Assignee } from "./model.js";

const PRIORITY_TOKEN = /(?:^|\s)[pP]([1-3])(?=\s|$)/g;
const TAG_TOKEN = /(?:^|\s)#([a-zA-Z0-9][a-zA-Z0-9-]*)(?=\s|$)/g;
const ASSIGNEE_TOKEN = /(?:^|\s)@(human|agent)(?=\s|$)/gi;

export interface ParsedTokens {
  /** Input with pN/@human/@agent tokens stripped; #tags remain in place. */
  text: string;
  /** Only set when a token was found; p2 comes back as 2 (caller omits default). */
  priority?: 1 | 2 | 3;
  /** Derived from #tokens left in the text (lowercase, in order of appearance). */
  tags: string[];
  /** Only set when an @human/@agent token was found. */
  assignee?: Assignee;
}

export function parseTokens(input: string): ParsedTokens {
  let priority: ParsedTokens["priority"];
  let assignee: Assignee | undefined;

  let text = input.replace(PRIORITY_TOKEN, (_, digit: string) => {
    priority = Number(digit) as 1 | 2 | 3; // last token wins
    return " ";
  });
  text = text.replace(ASSIGNEE_TOKEN, (_, who: string) => {
    assignee = who.toLowerCase() as Assignee; // last token wins
    return " ";
  });
  text = text.replace(/\s+/g, " ").trim();

  const result: ParsedTokens = { text, tags: deriveTags(text) };
  if (priority !== undefined) result.priority = priority;
  if (assignee !== undefined) result.assignee = assignee;
  return result;
}

/** The node's tag set: lowercase names of #tokens, in order of appearance, deduped. */
export function deriveTags(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(TAG_TOKEN)) {
    const tag = match[1]?.toLowerCase();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Append #tokens for any tags not already present in the text. Idempotent. */
export function appendTags(text: string, tags: readonly string[]): string {
  const existing = new Set(deriveTags(text));
  let out = text;
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (existing.has(tag)) continue;
    out = out ? `${out} #${tag}` : `#${tag}`;
    existing.add(tag);
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove the #tokens for the given tags from the text. */
export function stripTags(text: string, tags: readonly string[]): string {
  let out = text;
  for (const raw of tags) {
    const token = new RegExp(`(?:^|\\s)#${escapeRegExp(raw.toLowerCase())}(?=\\s|$)`, "gi");
    out = out.replace(token, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}
