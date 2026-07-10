/**
 * Tag filtering (SPEC "Tags"): visible = nodes whose text carries the tag,
 * plus all their ancestors (structure) and descendants (a tagged umbrella
 * includes its contents). Session-only view state.
 */
import { ancestors, deriveTags, subtreeIds, type Tree } from "@kalamu/core";

export function filterVisibleIds(tree: Tree, tag: string): Set<string> {
  const visible = new Set<string>();
  for (const node of tree.byId.values()) {
    if (!deriveTags(node.text).includes(tag)) continue;
    for (const ancestor of ancestors(tree, node)) visible.add(ancestor.id);
    for (const id of subtreeIds(tree, node.id)) visible.add(id);
  }
  return visible;
}
