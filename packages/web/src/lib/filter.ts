/**
 * View filters (never document content).
 *
 * Two independent narrowings live here:
 *
 * - the tag filter (SPEC "Tags"): visible = nodes whose text carries the tag,
 *   plus all their ancestors (structure) and descendants (a tagged umbrella
 *   includes its contents). Session-only.
 * - the author/assignee filters (SPEC key decision 15): each axis lists the
 *   values that stay visible; an absent axis — or one listing every value —
 *   means "show all". Persisted in ui-state.json.
 *
 * Both keep the ancestors of every match: hiding a structural bullet because
 * an agent wrote it would tear the outline apart around the rows it should be
 * showing.
 */
import {
  ancestors,
  deriveTags,
  subtreeIds,
  type Assignee,
  type KalamuNode,
  type OutlineFilters,
  type Tree,
} from "@kalamu/core";

/** Assignee axis values — `"unassigned"` is a value, not an absence (SPEC). */
export type AssigneeFilter = Assignee | "unassigned";

export const CREATED_BY_VALUES: readonly Assignee[] = ["human", "agent"];
export const ASSIGNEE_VALUES: readonly AssigneeFilter[] = ["human", "agent", "unassigned"];

/** Provenance of a node: `createdBy` is only ever persisted as `"agent"`. */
export function nodeCreatedBy(node: KalamuNode): Assignee {
  return node.createdBy ?? "human";
}

export function nodeAssignee(node: KalamuNode): AssigneeFilter {
  return node.assignee ?? "unassigned";
}

/** An axis narrows only when it omits at least one of its possible values. */
function axisNarrows<T extends string>(axis: readonly T[] | undefined, all: readonly T[]): boolean {
  return axis !== undefined && all.some((value) => !axis.includes(value));
}

/** Whether `value` survives an axis; an absent axis allows everything. */
export function axisAllows<T extends string>(axis: readonly T[] | undefined, value: T): boolean {
  return axis === undefined || axis.includes(value);
}

/**
 * Flip one value of an axis, in the canonical value order. Returns undefined
 * once every value is allowed again, so "all checked" is stored as an absent
 * axis rather than an exhaustive list.
 */
export function toggleAxis<T extends string>(
  axis: readonly T[] | undefined,
  all: readonly T[],
  value: T,
): T[] | undefined {
  const allowed = new Set<T>(axis ?? all);
  if (!allowed.delete(value)) allowed.add(value);
  if (allowed.size === all.length) return undefined;
  return all.filter((option) => allowed.has(option));
}

/**
 * The filters worth writing to ui-state.json: axes that actually narrow,
 * or null when nothing does (so the key can be omitted entirely).
 */
export function narrowedFilters(filters: OutlineFilters): OutlineFilters | null {
  const createdBy = axisNarrows(filters.createdBy, CREATED_BY_VALUES) ? filters.createdBy : undefined;
  const assignee = axisNarrows(filters.assignee, ASSIGNEE_VALUES) ? filters.assignee : undefined;
  if (createdBy === undefined && assignee === undefined) return null;
  return { ...(createdBy && { createdBy }), ...(assignee && { assignee }) };
}

/**
 * Whether a node survives the filters on its own merits (ancestors are added
 * separately). `createdBy` applies to every kind; `assignee` only to tasks —
 * bullets and discussions are never assigned (SPEC key decision 12), so an
 * assignee filter must not make the structure they carry disappear.
 */
export function matchesFilters(node: KalamuNode, filters: OutlineFilters): boolean {
  if (!axisAllows(filters.createdBy, nodeCreatedBy(node))) return false;
  return node.kind !== "task" || axisAllows(filters.assignee, nodeAssignee(node));
}

/** Ids the author/assignee filters leave visible, or null when they narrow nothing. */
export function filtersVisibleIds(tree: Tree, filters: OutlineFilters): Set<string> | null {
  const narrowed = narrowedFilters(filters);
  if (narrowed === null) return null;
  const visible = new Set<string>();
  for (const node of tree.byId.values()) {
    if (!matchesFilters(node, narrowed)) continue;
    visible.add(node.id);
    for (const ancestor of ancestors(tree, node)) visible.add(ancestor.id);
  }
  return visible;
}

/** Ids the active tag leaves visible: matches, their ancestors and their subtrees. */
export function tagVisibleIds(tree: Tree, tag: string): Set<string> {
  const visible = new Set<string>();
  for (const node of tree.byId.values()) {
    if (!deriveTags(node.text).includes(tag)) continue;
    for (const ancestor of ancestors(tree, node)) visible.add(ancestor.id);
    for (const id of subtreeIds(tree, node.id)) visible.add(id);
  }
  return visible;
}
