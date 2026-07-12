/**
 * Copy a node and its descendants as a markdown indented list — for pasting
 * into an agent chat. Operates on data, not visibility: collapsed
 * descendants are included. The format itself lives in @kalamu/core
 * (serializeMarkdown), shared with `kalamu show --format markdown`, so the
 * two can never drift.
 */
import { serializeMarkdown, type Tree } from "@kalamu/core";

export function serializeSubtree(tree: Tree, rootId: string): { text: string; count: number } {
  const root = tree.byId.get(rootId);
  if (!root) return { text: "", count: 0 };
  const text = serializeMarkdown(tree, [root]);
  return { text, count: text.split("\n").length };
}

/**
 * The "Copy prompt" text for a discussion node (SPEC key decision 12): the
 * topic, its subtree (indented as in copy-subtree, minus the node's own
 * line), and a do-not-code instruction telling the agent how to record the
 * outcome. `serverId` is the id as the CLI knows it — never a local alias.
 */
export function discussionPrompt(tree: Tree, rootId: string, serverId: string): string | null {
  const root = tree.byId.get(rootId);
  if (!root || root.kind !== "discussion") return null;
  // Drop the node's own line; children keep their as-serialized indentation.
  const subtree = serializeMarkdown(tree, [root]).split("\n").slice(1).join("\n");
  return [
    `Kalamu discussion ${serverId}: ${root.text}`,
    ...(subtree === "" ? [] : [subtree]),
    `This is for discussion only — do not make any code changes yet. When we reach a conclusion, help me record the outcome as child bullets under ${serverId} (kalamu add --parent ${serverId} --text "..."), then mark the discussion done (kalamu done ${serverId}).`,
  ].join("\n\n");
}

/** navigator.clipboard when available; hidden-textarea execCommand otherwise. */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the legacy path (insecure context or permission denied).
  }
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
  if (!ok) throw new Error("clipboard unavailable");
}
