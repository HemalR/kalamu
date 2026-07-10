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
