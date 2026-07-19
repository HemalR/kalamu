/**
 * The .gitignore entries `kalamu init` maintains (SPEC ".gitignore entries"):
 * view state and caches are never canonical and must not dirty the repo.
 * Callers only invoke this when the directory looks like a repo
 * (`looksLikeRepo`) — creating a .gitignore elsewhere would be presumptuous,
 * so init falls back to printing the entries as a suggestion.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const IGNORE_ENTRIES = [".kalamu/cache.sqlite", ".kalamu/ui-state.json", ".kalamu/*.lock"];

/** Patterns that already ignore the whole .kalamu directory — nothing to add. */
const WHOLE_DIR = [".kalamu", ".kalamu/", "/.kalamu", "/.kalamu/", ".kalamu/*", ".kalamu/**"];

/**
 * Append the missing entries to the root .gitignore (created when absent)
 * under a "# Kalamu" comment. Idempotent per line — a re-init adds only what
 * the file lacks and never duplicates. Returns the entries added.
 */
export function ensureGitignore(root: string): string[] {
  const path = join(root, ".gitignore");
  const content = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = new Set(content.split("\n").map((line) => line.trim()));
  if (WHOLE_DIR.some((pattern) => lines.has(pattern))) return [];
  const missing = IGNORE_ENTRIES.filter((entry) => !lines.has(entry));
  if (missing.length === 0) return [];
  const block = `# Kalamu view state and caches (never canonical)\n${missing.join("\n")}\n`;
  if (content === "") writeFileSync(path, block);
  else appendFileSync(path, `${content.endsWith("\n") ? "" : "\n"}\n${block}`);
  return missing;
}
