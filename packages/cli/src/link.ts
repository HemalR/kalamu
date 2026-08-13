/** Pure formatting for a human-readable, deep-linked Kalamu node reference. */

export interface NodeLink {
  id: string;
  text: string;
  url: string;
  markdown: string;
}

function firstLine(text: string): string {
  return text.split(/\r?\n/, 1)[0]?.trim() || "Untitled node";
}

function escapeMarkdownLabel(text: string): string {
  return text.replace(/[\\[\]]/g, "\\$&");
}

export function createNodeLink(node: { id: string; text: string }, slug: string, baseUrl: string): NodeLink {
  const text = firstLine(node.text);
  const url = `${baseUrl}/p/${encodeURIComponent(slug)}#z=${encodeURIComponent(node.id)}`;
  return {
    id: node.id,
    text,
    url,
    markdown: `[${escapeMarkdownLabel(text)}](${url}) (\`${node.id}\`)`,
  };
}
