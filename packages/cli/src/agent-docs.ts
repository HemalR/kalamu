/**
 * The standing instruction `kalamu init` plants in a project's agent docs
 * (CLAUDE.md / AGENTS.md): the outline records only deferred work — never the
 * live conversation — agents add tasks in three enumerated cases only, and
 * discussions are created by humans, never by agents.
 * Idempotent AND self-upgrading: the marker pair bounds the block, so init can
 * run repeatedly — a missing block is appended, a stale one (from an older
 * kalamu) is replaced in place, and a current one is left untouched. Text
 * outside the markers is never modified.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "<!-- kalamu:agents -->";
const END_MARKER = "<!-- /kalamu:agents -->";

const BLOCK = [
  MARKER,
  "",
  "## Kalamu",
  "",
  "This repo tracks deferred work in a Kalamu outline (`.kalamu/outline.jsonl`). Use the `kalamu` CLI (or `npx kalamu`) — never edit the file by hand. `kalamu next` returns the most urgent open task; claim it with `kalamu start <id>` before working so another session can't take it (`kalamu end <id>` returns an abandoned claim to the queue).",
  "",
  "The outline is a parking lot for deferred work, never a log of the current conversation. Agents add nodes in exactly three cases, always `--kind task`:",
  "",
  "1. Work discovered in this conversation but deliberately not done in it — `kalamu add` instead of a TODO comment.",
  "2. Something the human must do that this conversation won't deliver (a decision for later, a credential, a manual step outside the repo):",
  "",
  "   ```bash",
  '   kalamu add --kind task --text "<what the human must do>" --assign human --parent <id>',
  "   ```",
  "",
  "   Human-assigned tasks never surface in `kalamu next`, so agents won't pick them up.",
  "",
  "3. The human explicitly asked for it to be tracked.",
  "",
  "Nothing else becomes a node — findings, summaries, live topics, and outcomes belong in chat. When unsure, don't record: say it in chat and let the human park it.",
  "",
  "Placement is part of the record. Before adding, walk to the parent one level at a time (`kalamu ls`, then `kalamu ls <id>`) or `kalamu search <term>` (each hit includes its Path), and nest with `--parent <id>` — work discovered while doing a task usually belongs under that task or its umbrella; a human-assigned follow-up belongs under the work that raised it. Add at top level only when the node starts a genuinely new area, never because finding the parent takes effort.",
  "",
  "Never refer to a Kalamu node to the human by ID alone. Name it using the first line of its text; use `kalamu link <id>` when a clickable, copy-ready reference would help.",
  "",
  'Nodes with `kind: "discussion"` are the human\'s tool for parking conversations to have with an agent later — never create one, never treat one as coding work; `kalamu next` never returns them. When the human brings one to a session (a pasted discussion prompt, or by id), discuss only: make no code changes, record the outcome as child bullets under the node, then mark it done.',
  END_MARKER,
  "",
].join("\n");

/**
 * Plant a marker-fenced block in the project's agent docs: every
 * CLAUDE.md/AGENTS.md that exists at the root, or a new AGENTS.md when neither
 * does. A file already carrying the block gets it refreshed in place when the
 * text has changed since it was planted. Returns the files written (empty when
 * the current block is already everywhere it belongs). A file with a start
 * marker but no end marker has been hand-edited past recognition and is left
 * alone. `block` must begin with `marker` and end with `endMarker` + newline.
 */
export function ensureDocBlock(root: string, marker: string, endMarker: string, block: string): string[] {
  const existing = ["AGENTS.md", "CLAUDE.md"].filter((file) => existsSync(join(root, file)));
  const targets = existing.length ? existing : ["AGENTS.md"];
  const written: string[] = [];
  for (const file of targets) {
    const path = join(root, file);
    if (!existsSync(path)) {
      writeFileSync(path, block);
      written.push(file);
      continue;
    }
    const content = readFileSync(path, "utf8");
    const start = content.indexOf(marker);
    if (start === -1) {
      appendFileSync(path, `${content === "" || content.endsWith("\n") ? "" : "\n"}\n${block}`);
      written.push(file);
      continue;
    }
    const end = content.indexOf(endMarker, start);
    if (end === -1) continue;
    const span = content.slice(start, end + endMarker.length);
    const current = block.trimEnd();
    if (span === current) continue;
    writeFileSync(path, content.slice(0, start) + current + content.slice(end + endMarker.length));
    written.push(file);
  }
  return written;
}

/** The standing Kalamu instruction (see BLOCK above), planted by every init. */
export function ensureAgentDocs(root: string): string[] {
  return ensureDocBlock(root, MARKER, END_MARKER, BLOCK);
}
