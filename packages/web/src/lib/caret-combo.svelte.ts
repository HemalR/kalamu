/**
 * The editor's caret combobox: `@` repo files, `/` assignees (tasks only) and
 * `#` tags. It opens when its trigger is typed at a word boundary, and the
 * letters typed after the trigger form a prefix filter. It never edits the
 * text while open — characters insert natively — and only a pick changes the
 * draft. OutlineNode feeds it keys and applies its edits; this class holds no
 * DOM, so the state machine is unit-tested on its own.
 */
import type { Assignee } from "@kalamu/core";

export type ComboKind = "assign" | "tag" | "file";

/** One row; the kind says what `value` is and how a pick applies it. */
export type ComboOption =
  | { kind: "assign"; value: Assignee }
  | { kind: "tag"; value: string }
  | { kind: "file"; value: string };

export const COMBO_TRIGGERS: Readonly<Record<string, ComboKind>> = { "@": "file", "#": "tag", "/": "assign" };

/** Accessible names for each kind's list. */
export const COMBO_LABELS: Readonly<Record<ComboKind, string>> = { assign: "Assign", file: "Files", tag: "Tags" };

export interface ComboSource {
  options(kind: ComboKind, filter: string): ComboOption[];
  /** The kind's list is still loading: open and keep narrowing even with no matches yet. */
  loading(kind: ComboKind): boolean;
}

/** What handleKey asks of the editor beyond its own native handling. */
export type ComboKeyResult =
  /** Fully handled here: skip the editor's own key handling. */
  | "consumed"
  /** Not (or no longer) ours: handle the key as usual. */
  | "pass"
  /** Enter on a row: the editor should pick it. */
  | { pick: ComboOption };

/** A pick's edit to the draft, and any metadata it sets. */
export interface ComboEdit {
  draft: string;
  caret: number;
  assignee?: Assignee;
}

/** The keys handleKey reads; a KeyboardEvent satisfies it. */
type ComboKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "preventDefault">;

export class CaretCombo {
  kind = $state<ComboKind | null>(null);
  filter = $state("");
  index = $state(0);
  /** The caret's line box relative to the row (the menu hangs below it, or
      above when the viewport has no room); null until measured. */
  pos = $state<{ left: number; top: number; height: number } | null>(null);
  /** Draft offset of the typed trigger — where a pick edits from. */
  private start = 0;
  private readonly source: ComboSource;
  readonly matches: ComboOption[];

  constructor(source: ComboSource) {
    this.source = source;
    this.matches = $derived(this.kind === null ? [] : source.options(this.kind, this.filter));
  }

  close(): void {
    this.kind = null;
    this.filter = "";
    this.index = 0;
    this.pos = null;
  }

  /**
   * The trigger for `kind` was just pressed with the caret at `offset` (null
   * when there is a selection). Opens only at a word boundary and when there
   * is something to offer — no tags yet means plain typing.
   */
  open(kind: ComboKind, draft: string, offset: number | null): boolean {
    if (offset === null) return false;
    if (offset !== 0 && !/\s/.test(draft.charAt(offset - 1))) return false;
    if (this.source.options(kind, "").length === 0 && !this.source.loading(kind)) return false;
    this.close();
    this.start = offset;
    this.kind = kind;
    return true;
  }

  /** One keydown while open. Characters still type natively; this only tracks them. */
  handleKey(event: ComboKey): ComboKeyResult {
    const kind = this.kind;
    if (kind === null) return "pass";
    const mod = event.metaKey || event.ctrlKey;
    // Bare modifier presses (e.g. Shift for a capital letter) mean nothing here.
    if (["Shift", "Alt", "Control", "Meta"].includes(event.key)) return "consumed";
    if (event.key === "Escape") {
      event.preventDefault();
      this.close(); // leave the text exactly as typed
      return "consumed";
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !mod && !event.altKey) {
      event.preventDefault();
      const count = this.matches.length;
      if (count > 0) this.index = (this.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      return "consumed";
    }
    if (event.key === "Enter" && !mod && !event.shiftKey && !event.altKey) {
      const choice = this.matches[this.index];
      if (choice !== undefined) {
        event.preventDefault();
        return { pick: choice };
      }
      this.close();
      return "pass";
    }
    if (event.key === "Backspace" && !mod && !event.altKey) {
      if (this.filter === "") this.close(); // this press deletes the trigger itself
      else {
        this.filter = this.filter.slice(0, -1);
        this.index = 0;
      }
      return "pass"; // the deletion happens natively either way
    }
    if (event.key.length === 1 && !mod && !event.altKey) {
      // File paths are full of `.` `/` `-` `_`, so every printable key narrows
      // here rather than reaching the trigger handler. A list still loading
      // isn't "nothing matches" — keep narrowing.
      const next = this.filter + event.key;
      if (event.key !== " " && (this.source.options(kind, next).length > 0 || this.source.loading(kind))) {
        this.filter = next;
        this.index = 0;
        return "pass"; // the character types natively and narrows the filter
      }
      this.close(); // space or non-matching character: leave the text as typed
      return "pass"; // a space still falls through to parse-on-space
    }
    // Structural/navigation keys (Tab, mod combos, caret moves…) close it.
    this.close();
    return "pass";
  }

  /**
   * Replace the typed fragment (trigger through `caret`) and close. `/`
   * removes it and sets the assignee (metadata); `#` and `@` complete it to
   * the full token, which stays in the text and chips on blur (SPEC key
   * decision 7). A picked path gets one trailing space so the next word
   * starts clean.
   */
  pick(option: ComboOption, draft: string, caret: number): ComboEdit {
    const start = this.start;
    this.close();
    const replacement = option.kind === "tag" ? `#${option.value}` : option.kind === "file" ? `@${option.value} ` : "";
    return {
      draft: draft.slice(0, start) + replacement + draft.slice(caret),
      caret: start + replacement.length,
      ...(option.kind === "assign" ? { assignee: option.value } : {}),
    };
  }
}
