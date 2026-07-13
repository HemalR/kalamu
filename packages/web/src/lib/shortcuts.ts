/**
 * Single source of truth for keyboard shortcuts: the outline's keydown
 * handler matches against these combos, and the cheat sheet renders the same
 * entries — so the dialog cannot drift from the actual bindings.
 *
 * Entries without a `combo` have guards that live in code (caret position,
 * empty text); their display rows still come from here.
 */

export interface Combo {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Shortcut {
  combo?: Combo;
  /** Display label; "Mod" and "Alt" are replaced per platform when rendered. */
  keys: string;
  does: string;
  /** Only shown/active when the app is served under the hub (/p/<slug>). */
  hubOnly?: boolean;
}

export function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const combo = shortcut.combo;
  if (!combo) return false;
  if ((combo.mod ?? false) !== (event.metaKey || event.ctrlKey)) return false;
  if ((combo.shift ?? false) !== event.shiftKey) return false;
  if ((combo.alt ?? false) !== event.altKey) return false;
  return event.key.toLowerCase() === combo.key.toLowerCase();
}

export const SHORTCUTS = {
  newSibling: { combo: { key: "Enter" }, keys: "Enter", does: "New item below — on an empty item it cycles the kind instead" },
  lineBreak: { keys: "Shift+Enter", does: "Line break inside the item" },
  cycleKind: { combo: { key: "Enter", mod: true }, keys: "Mod+Enter", does: "Cycle bullet / task / discussion" },
  indent: { combo: { key: "Tab" }, keys: "Tab", does: "Indent (become child of the previous sibling)" },
  outdent: { combo: { key: "Tab", shift: true }, keys: "Shift+Tab", does: "Outdent" },
  focusMove: { keys: "↑ / ↓", does: "Move focus between items (at the first/last line), keeping your column" },
  moveUp: { combo: { key: "ArrowUp", mod: true }, keys: "Mod+↑", does: "Move item up among its siblings" },
  moveDown: { combo: { key: "ArrowDown", mod: true }, keys: "Mod+↓", does: "Move item down among its siblings" },
  // Not Mod+D: preventable while editing, but it falls through to the browser's
  // bookmark dialog when no node is focused.
  toggleDone: { combo: { key: "Enter", mod: true, shift: true }, keys: "Mod+Shift+Enter", does: "Done / reopen" },
  toggleCollapse: { combo: { key: ".", mod: true }, keys: "Mod+.", does: "Collapse / expand children" },
  clearPriority: { keys: "Backspace", does: "At the start of the text: clear the item's priority" },
  deleteEmpty: { keys: "Backspace", does: "On an empty item: delete it" },
  deleteSubtree: { combo: { key: "Backspace", mod: true, shift: true }, keys: "Mod+Shift+Backspace", does: "Delete item with its subtree (undoable)" },
  copySubtree: { combo: { key: "c", mod: true }, keys: "Mod+C", does: "Copy item and its sub-items (when nothing is selected)" },
  copyId: { combo: { key: "c", mod: true, shift: true }, keys: "Mod+Shift+C", does: "Copy the item's id (for CLI commands) — on a discussion: its agent prompt" },
  undo: { combo: { key: "z", mod: true }, keys: "Mod+Z", does: "Undo" },
  redo: { combo: { key: "z", mod: true, shift: true }, keys: "Mod+Shift+Z", does: "Redo" },
  palette: { combo: { key: "k", mod: true }, keys: "Mod+K", does: "Open the command palette (priority, labels, assign, done, view sheets)" },
  openProject: { keys: "Mod+Shift+1…9", does: "Open the nth sidebar project", hubOnly: true },
  help: { combo: { key: "/", mod: true }, keys: "Mod+/", does: "Show this cheat sheet" },
  helpQuestion: { keys: "?", does: "Show this cheat sheet (when not editing)" },
  escape: { keys: "Esc", does: "Close this cheat sheet; clear the active tag filter (when not editing)" },
} satisfies Record<string, Shortcut>;

export const TOKEN_HINTS: readonly { token: string; does: string }[] = [
  { token: "p1 … p5", does: "Priority in text — p1 urgent, p5 low; p3 is the default and shows no badge" },
  { token: "#tag", does: "Stays in the text and renders as a coloured chip in place; typing # suggests existing tags; click a chip to recolour, edit it like any other word" },
  { token: "@", does: "Opens the assign menu — pick human or agent for the task" },
  { token: "@human / @agent", does: "Assigns the task directly — human-assigned tasks are skipped by agents and `kalamu next`" },
  { token: "![](…)", does: "Paste an image — stored in .kalamu/assets/ and shown as a thumbnail in place" },
];
