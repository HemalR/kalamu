/**
 * Split node text into plain-text, #tag, pasted-image, and link segments for
 * inline rendering (SPEC key decisions 7 and 11). The tag regex mirrors
 * core's tokens.ts: whole words only, never inside longer words like
 * `issue#42`. Image tokens are markdown pointing into `.kalamu/assets/`.
 * Links are explicit http(s):// URLs only — no bare domains, false-positive
 * safety in a note-taking tool beats coverage.
 */
import { apiBase } from "./api";

export interface TextSegment {
  kind: "text";
  text: string;
  /** Offset of this segment in the source text (for caret mapping). */
  start: number;
}

export interface TagSegment {
  kind: "tag";
  /** Tag as typed, without the leading `#` — the chip label. */
  label: string;
  /** Lowercased name, for colour lookup and meta overrides. */
  name: string;
  start: number;
  /** Length of the raw token in the source text, including the `#`. */
  length: number;
}

export interface ImageSegment {
  kind: "image";
  alt: string;
  /** Relative path as stored in text, e.g. `.kalamu/assets/img-abc.png`. */
  path: string;
  start: number;
  /** Length of the raw `![alt](path)` token in the source text. */
  length: number;
}

export interface LinkSegment {
  kind: "link";
  /** The URL exactly as typed (post-trim) — both the href and the label. */
  href: string;
  start: number;
  /** Length of the URL in the source text. */
  length: number;
}

export type Segment = TextSegment | TagSegment | ImageSegment | LinkSegment;

const TAG_TOKEN = /(?:^|\s)#([a-zA-Z0-9][a-zA-Z0-9-]*)(?=\s|$)/g;
const IMAGE_TOKEN = /!\[([^\]]*)\]\((\.kalamu\/assets\/[^)\s]+)\)/g;
const LINK_TOKEN = /https?:\/\/\S+/g;

/** Trailing punctuation that's almost never part of a pasted URL. */
const LINK_TRAILING = new Set([".", ",", ";", ":", "!", "?", "'", '"', "›", "»"]);
const LINK_CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

function countChar(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/**
 * Trim trailing punctuation off a matched URL run. Closing brackets drop only
 * while unbalanced within the URL, so `…/wiki/Foo_(bar)` keeps its paren but
 * `(see https://x.com)` sheds it.
 */
function trimUrl(url: string): string {
  for (;;) {
    const last = url.slice(-1);
    const opener = LINK_CLOSERS[last];
    if (LINK_TRAILING.has(last) || (opener !== undefined && countChar(url, last) > countChar(url, opener))) {
      url = url.slice(0, -1);
      continue;
    }
    return url;
  }
}

/** The browser-visible URL for an asset path stored in node text. */
export function assetUrl(path: string): string {
  return path.replace(/^\.kalamu\/assets\//, `${apiBase}/assets/`);
}

/**
 * Character spans of the #tag tokens in `text` (`#` included) with their
 * lowercase names — the ranges to colour while editing (SPEC key decision 7:
 * "chips in waiting").
 */
export function tagSpans(text: string): { start: number; end: number; name: string }[] {
  const out: { start: number; end: number; name: string }[] = [];
  for (const seg of segmentText(text)) {
    if (seg.kind === "tag") out.push({ start: seg.start, end: seg.start + seg.length, name: seg.name });
  }
  return out;
}

export function segmentText(text: string): Segment[] {
  const images: ImageSegment[] = [];
  for (const match of text.matchAll(IMAGE_TOKEN)) {
    images.push({
      kind: "image",
      alt: match[1] ?? "",
      path: match[2] ?? "",
      start: match.index,
      length: match[0].length,
    });
  }
  const insideImage = (index: number): boolean =>
    images.some((t) => index >= t.start && index < t.start + t.length);

  // Links parse before tags: a #fragment inside a URL must never chip, and a
  // URL inside an image token (its alt text) is not a link.
  const links: LinkSegment[] = [];
  for (const match of text.matchAll(LINK_TOKEN)) {
    if (insideImage(match.index)) continue;
    const href = trimUrl(match[0]);
    if (!/^https?:\/\/./.test(href)) continue; // a bare scheme is not a link
    links.push({ kind: "link", href, start: match.index, length: href.length });
  }
  const insideLink = (index: number): boolean =>
    links.some((t) => index >= t.start && index < t.start + t.length);

  const tokens: (TagSegment | ImageSegment | LinkSegment)[] = [...images, ...links];
  for (const match of text.matchAll(TAG_TOKEN)) {
    const label = match[1];
    if (label === undefined) continue;
    const start = match.index + match[0].indexOf("#");
    if (insideImage(start) || insideLink(start)) continue;
    tokens.push({ kind: "tag", label, name: label.toLowerCase(), start, length: label.length + 1 });
  }
  tokens.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor) continue; // overlapping runs (pathological text): first token wins
    if (token.start > cursor) out.push({ kind: "text", text: text.slice(cursor, token.start), start: cursor });
    out.push(token);
    cursor = token.start + token.length;
  }
  if (cursor < text.length || out.length === 0) {
    out.push({ kind: "text", text: text.slice(cursor), start: cursor });
  }
  return out;
}
