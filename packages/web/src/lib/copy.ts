/** Copy context for pasting a focused node into an agent chat. */
import { ancestors, markdownLine, serializeMarkdown, type NodeKind, type Tree } from "@kalamu/core";

const KIND_LABEL: Record<NodeKind, string> = {
  bullet: "Bullet",
  task: "Task",
  discussion: "Discussion",
};

/**
 * Format the direct ancestor path and the selected node's whole subtree.
 * Siblings of both the ancestors and the selected node are deliberately
 * excluded. This operates on document data rather than visibility, so
 * collapsed descendants are still included.
 *
 * `serverId` is the stable id understood by the CLI. During an optimistic
 * create it can differ from `rootId`, which is the store's temporary key.
 */
export function serializeNodeContext(
  tree: Tree,
  rootId: string,
  serverId: string,
): { text: string; count: number } {
  const root = tree.byId.get(rootId);
  if (!root) return { text: "", count: 0 };
  const path = ancestors(tree, root);
  const subtreeLines = serializeMarkdown(tree, [root]).split("\n");
  const body = [
    ...path.map((node, depth) => `${"  ".repeat(depth)}${markdownLine(node)}`),
    ...subtreeLines.map((line) => `${"  ".repeat(path.length)}${line}`),
  ].join("\n");
  const text = ["---", `Kalamu ${KIND_LABEL[root.kind]} ID: ${serverId}`, "", body, "---"].join("\n");
  return { text, count: path.length + subtreeLines.length };
}

/** The node's text exactly as stored, or the current editor draft when supplied. */
export function rawNodeText(tree: Tree, id: string, draft?: string): string | null {
  const node = tree.byId.get(id);
  if (!node) return null;
  return draft ?? node.text;
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
