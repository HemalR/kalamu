/**
 * The derived one-glance label behind Overview mode.
 *
 * Nothing is stored: a node has one text field and this reads it (SPEC
 * discussion n_0J27PC6VYW — no second field, the label is derived). That
 * discussion said "first line", which cannot work: Enter creates a new node,
 * so no node text contains a newline. Sentences are the only real boundary.
 *
 * Measured against a 118-node outline whose median text is 434 characters:
 * the first sentence alone is still over 80 characters three times in four,
 * so the sentence is a refinement and the cut points do the work. Taking the
 * EARLIEST of sentence end, spaced dash, or colon shortens 96 of 118 rows to a
 * median of 66 characters. Whatever survives is clamped to two lines by CSS,
 * which is what bounds the long tail — this function never counts pixels.
 */

/**
 * Below this a cut is a stub, not a summary: "Done:" and "Fix:" are status
 * prefixes, and "PHASE 4 —" is a number. Skip those and take the next cut.
 *
 * Tuned against 177 real nodes: 20 is the lowest floor that yields no stub at
 * all. Dropping to 16 starts producing "OUTCOME 2026-08-05", and 12 gives
 * "Work on emails" and "Post-migration" — cuts that shorten by discarding the
 * only informative half. Raising it to 24 buys nothing and loses two rows.
 */
const MIN_SUMMARY = 20;

/**
 * Bracket depth at each index. A cut inside brackets reads as a broken
 * thought — "DEFERRED to SSO setup time (Hemal 2026-07-28" — so candidates
 * that land inside one are rejected and the next boundary wins.
 */
function bracketDepths(text: string): number[] {
  const out: number[] = [];
  let depth = 0;
  for (const char of text) {
    if (char === "(" || char === "[") depth++;
    out.push(depth);
    if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
  }
  return out;
}

let segmenter: Intl.Segmenter | undefined;

/** Built into the browser — no dependency, and it knows "v0.9.0" is not two sentences. */
function firstSentenceEnd(text: string): number | null {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: "sentence" });
  const first = [...segmenter.segment(text)][0]?.segment.trimEnd();
  return first !== undefined && first.length < text.length ? first.length : null;
}

/**
 * The shortened label, or `null` when the text is already its own summary.
 * Callers render `null` as the text unchanged — no ellipsis, nothing hidden.
 */
export function summarize(text: string): string | null {
  const full = text.trim();
  const depths = bracketDepths(full);
  const candidates: number[] = [];

  const sentence = firstSentenceEnd(full);
  if (sentence !== null) candidates.push(sentence);

  // A SPACED dash only: "shadow-mode", "multi-tenant" and "stripe->invoice"
  // must never be cut mid-token. Every occurrence is a candidate: the first
  // may fall below MIN_SUMMARY or inside brackets, and a later one can still
  // make the cut.
  for (const match of full.matchAll(/\s[—–-]\s/g)) candidates.push(match.index);

  // A colon followed by whitespace, so "https://", "10:30" and "a::b" are safe.
  for (const match of full.matchAll(/:\s/g)) candidates.push(match.index);

  const usable = candidates.filter((at) => at >= MIN_SUMMARY && depths[at] === 0);
  if (usable.length === 0) return null;

  const cut = full.slice(0, Math.min(...usable)).replace(/[\s—–:-]+$/, "");
  return cut === full ? null : cut;
}
