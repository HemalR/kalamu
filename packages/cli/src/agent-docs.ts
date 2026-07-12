/**
 * The standing instruction `kalamu init` plants in a project's agent docs
 * (CLAUDE.md / AGENTS.md): when work needs the human to act, agents must
 * record a human-assigned task instead of only mentioning it in chat.
 * Idempotent — the marker comment is the "already installed" check, so init
 * can run repeatedly and existing projects adopt the block by re-running it.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "<!-- kalamu:agents -->";

const BLOCK = [
  MARKER,
  "",
  "## Kalamu",
  "",
  "This repo tracks deferred work in a Kalamu outline (`.kalamu/outline.jsonl`). Use the `kalamu` CLI (or `npx kalamu`) — never edit the file by hand. `kalamu next` returns the most urgent open task; record work you discover but don't do with `kalamu add` instead of TODO comments.",
  "",
  "Whenever your work needs the human to do something (a decision, a credential, a manual step outside the repo), don't just say so in chat — also record it so it survives the conversation:",
  "",
  "```bash",
  'kalamu add --kind task --text "<what the human must do>" --assign human',
  "```",
  "",
  "Human-assigned tasks never surface in `kalamu next`, so agents won't pick them up.",
  "",
  'Nodes with `kind: "discussion"` are conversations to have with the human, never coding work — `kalamu next` never returns them and you must never implement one unprompted. When the human brings one to you (a pasted discussion prompt, or a topic to raise with `kalamu add --kind discussion`), discuss only: make no code changes, record the outcome as child bullets under the discussion node, then mark it done.',
  "<!-- /kalamu:agents -->",
  "",
].join("\n");

/**
 * Add the block to the project's agent docs: every CLAUDE.md/AGENTS.md that
 * exists at the root, or a new AGENTS.md when neither does. Returns the
 * files written (empty when the block is already everywhere it belongs).
 */
export function ensureAgentDocs(root: string): string[] {
  const existing = ["AGENTS.md", "CLAUDE.md"].filter((file) => existsSync(join(root, file)));
  const targets = existing.length ? existing : ["AGENTS.md"];
  const written: string[] = [];
  for (const file of targets) {
    const path = join(root, file);
    if (existsSync(path)) {
      const content = readFileSync(path, "utf8");
      if (content.includes(MARKER)) continue;
      appendFileSync(path, `${content === "" || content.endsWith("\n") ? "" : "\n"}\n${BLOCK}`);
    } else {
      writeFileSync(path, BLOCK);
    }
    written.push(file);
  }
  return written;
}
