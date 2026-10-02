/**
 * Option wording shared by every surface that offers the same choice — the
 * row menus, the caret combobox, the command palette and the filter menu — so
 * they can never drift apart.
 */
import type { Assignee } from "@kalamu/core";
import type { Priority } from "./api";
import type { AssigneeFilter } from "./filter";

export const PRIORITY_OPTIONS: readonly { value: Priority; label: string }[] = [
  { value: 1, label: "p1 · high" },
  { value: 2, label: "p2 · medium (default)" },
  { value: 3, label: "p3 · low" },
];

/** Assign-menu rows (row menu, `/` combobox, palette). "unassigned" clears. */
export const ASSIGN_LABELS: Record<AssigneeFilter, string> = {
  human: "Human — agents skip the task",
  agent: "Agent",
  unassigned: "Unassigned",
};

/** Short names, where a value is filtered on rather than chosen. */
export const ASSIGNEE_NAMES: Record<AssigneeFilter, string> = {
  human: "Human",
  agent: "Agent",
  unassigned: "Unassigned",
};

/** Assignees whose name starts with `filter` (case-insensitive) — the `/` combobox's list. */
export function matchAssignees(filter: string): Assignee[] {
  const query = filter.toLowerCase();
  return (["human", "agent"] as const).filter((option) => option.startsWith(query));
}
