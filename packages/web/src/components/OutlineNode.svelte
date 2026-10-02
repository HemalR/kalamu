<!--
  One outline node and, recursively, its visible children. Owns editing: the
  text swaps between two renderings (SPEC key decisions 7 and 9) — while
  editing, a contenteditable shows the raw source text; otherwise NodeText
  renders #tokens as inline chips. The component (keyed by node.id) persists
  across the swap, and external updates (SSE refetch) never touch the draft or
  caret while editing. The row's furniture lives in NodeGlyph, PriorityPicker
  and NodeMeta.
-->
<script module lang="ts">
  import { MediaQuery } from "svelte/reactivity";
  import { PHONE_QUERY } from "../lib/breakpoints";

  /** One query for every row: phones move the row's copy/delete buttons into its meta row. */
  const phone = new MediaQuery(PHONE_QUERY);
</script>

<script lang="ts">
  import { parseNumbering, tagColor, withNumbering, type KalamuNode } from "@kalamu/core";
  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import { api } from "../lib/api";
  import {
    caretOffset,
    caretOnFirstLine,
    caretOnLastLine,
    caretScreenX,
    collapsedCaret,
    placeCaret,
    placeCaretAtPoint,
    placeCaretAtX,
    selectionOffsets,
  } from "../lib/caret";
  import { CaretCombo, COMBO_LABELS, COMBO_TRIGGERS, type ComboKind, type ComboOption } from "../lib/caret-combo.svelte";
  import { tokenBeforeCaret } from "../lib/commit";
  import { fileRefs } from "../lib/file-refs.svelte";
  import { clearTagHighlights, updateTagHighlights } from "../lib/highlight";
  import type { FocusTarget, OutlineStore } from "../lib/outline.svelte";
  import { splitPasteLines } from "../lib/paste";
  import { basename, segmentText, type DocSegment } from "../lib/segments";
  import { matches, SHORTCUTS as S } from "../lib/shortcuts";
  import { summarize } from "../lib/summary";
  import { ASSIGN_LABELS, matchAssignees } from "../lib/vocab";
  import AssigneeIcon from "./AssigneeIcon.svelte";
  import DocPeek from "./DocPeek.svelte";
  import Menu from "./Menu.svelte";
  import NodeGlyph from "./NodeGlyph.svelte";
  import NodeMeta from "./NodeMeta.svelte";
  import NodeText, { peekKey, sourceOffsetAt } from "./NodeText.svelte";
  import Self from "./OutlineNode.svelte";
  import PriorityPicker from "./PriorityPicker.svelte";

  interface Props {
    node: KalamuNode;
    store: OutlineStore;
  }

  let { node, store }: Props = $props();

  let editing = $state(false);
  let draft = $state("");

  // Numbered lists (core numbering.ts): the `N.` prefix is metadata like the
  // priority field — shown as an ordinal before the text, never in the draft.
  // Core rewrites the ordinal from sibling position on every write, so the
  // editor only ever decides WHETHER the node is numbered, not what number.
  const numbering = $derived(parseNumbering(node.text));
  /** node.text minus its numbering prefix: what the editable and the display show. */
  const body = $derived(numbering?.body ?? node.text);
  /** Draft back to stored form: re-attach the prefix if the node is numbered. */
  function fromDraft(text: string): string {
    return numbering === null ? text : withNumbering(text, numbering.ordinal);
  }
  let el: HTMLElement | undefined;
  let displayEl = $state<HTMLElement>();
  let rowEl: HTMLElement | undefined;

  // Losing the server drops the node back to the display rendering (the
  // editable unmounts, so typing is impossible); focusAt refuses to re-enter
  // editing until the connection returns. The uncommitted draft is discarded —
  // it could not have been saved anyway.
  $effect(() => {
    if (!store.connected && editing) {
      combo.close();
      editing = false;
      clearTagHighlights();
    }
  });

  const children = $derived(store.visibleChildren(node.id));
  const hasChildren = $derived(children.length > 0);
  const isCollapsed = $derived(store.collapsed.has(node.id));
  // Done bullets are visual only (strikethrough) — they stay non-work-items.
  const isDone = $derived(node.doneAt !== null);
  const textLabel = $derived(
    node.kind === "task" ? "Task text" : node.kind === "discussion" ? "Discussion text" : "Bullet text",
  );
  /** The meta row describes the text to assistive tech: state, progress, blockers, owner, age. */
  const metaId = $derived(`meta-${node.id}`);
  const comboId = $derived(`combo-${node.id}`);

  // Overview mode is display-only: the editable always binds the raw text —
  // nobody ever edits a summary — and the store, copy, filters and the CLI
  // never see the label.
  /** The shortened label, or null when the row shows its text in full (see lib/summary.ts). */
  const label = $derived(store.overview ? summarize(body) : null);
  const segments = $derived(segmentText(label ?? body));

  /** Doc references expanded read-only under the row (NodeText toggles them). */
  const peeks = new SvelteSet<string>();
  const openPeeks = $derived(
    segments.filter((seg): seg is DocSegment => seg.kind === "doc" && peeks.has(peekKey(seg))),
  );

  /** Mount the editable (if needed), then place the caret. */
  async function focusAt(target: FocusTarget): Promise<void> {
    if (!editing) {
      if (!store.connected) {
        displayEl?.focus(); // read-only while the server is unreachable
        return;
      }
      draft = body;
      editing = true;
      await tick();
    }
    if (!el) return;
    if (typeof target === "object") placeCaretAtX(el, target.x, target.line);
    else placeCaret(el, target);
  }

  function registerHandle() {
    store.handles.set(node.id, { focusAt: (target) => void focusAt(target) });
    return () => {
      store.handles.delete(node.id);
    };
  }

  /**
   * The editable is mounted exactly while editing, so its lifetime is also the
   * caret claim the store's caption rule reads. clearCaret only clears a claim
   * this node still owns — when focus moves, the new owner may register before
   * this one tears down.
   */
  function registerEditable(element: HTMLElement) {
    el = element;
    store.setCaret(node.id);
    return () => {
      if (el === element) el = undefined;
      store.clearCaret(node.id);
    };
  }

  /** Full token parsing happens here — on Enter/blur/structural keys, never per keystroke. */
  function commit(): void {
    if (editing) store.commitText(node.id, fromDraft(draft));
  }

  function currentRawText(): string {
    return editing ? fromDraft(draft) : node.text;
  }

  function onEditableFocus(): void {
    store.lastFocusedId = node.id; // the command palette acts on this node
    if (!editing) {
      draft = body;
      editing = true;
    }
    refreshHighlights();
  }

  function onEditableBlur(): void {
    combo.close();
    commit();
    editing = false;
    clearTagHighlights();
  }

  /** Put the caret at `offset` once a draft change has reached the DOM. */
  async function caretAfterUpdate(offset: number): Promise<void> {
    const element = el;
    await tick();
    if (element) placeCaret(element, offset);
  }

  // ---- caret combobox: @ repo files, / assignees (tasks only), # tags --------

  const combo = new CaretCombo({
    options(kind, filter): ComboOption[] {
      // Bullets have tags, not assignees: an empty list never opens.
      if (kind === "assign") return node.kind === "task" ? matchAssignees(filter).map((value) => ({ kind, value })) : [];
      if (kind === "file") return fileRefs.match(filter).map((value) => ({ kind, value }));
      const query = filter.toLowerCase();
      return store.allTags.filter((tag) => tag.toLowerCase().startsWith(query)).map((value) => ({ kind, value }));
    },
    // The file list loads lazily, so an empty one is "not fetched yet", not "nothing to offer".
    loading: (kind) => kind === "file" && fileRefs.files.length === 0,
  });

  /** Showing a list: measured, and with something to offer (a file list still
      loading opens the combo but has no rows yet, and an empty box helps nobody). */
  const comboOpen = $derived(combo.kind !== null && combo.pos !== null && combo.matches.length > 0);

  /** The trigger was typed: open at a word boundary, then measure where the menu hangs. */
  function openCombo(kind: ComboKind): void {
    if (kind === "file") fileRefs.load();
    if (!el || !combo.open(kind, draft, collapsedCaret(el))) return;
    // Measure after the browser inserts the trigger, so the caret rect exists.
    requestAnimationFrame(() => {
      if (combo.kind === null || !rowEl) return;
      const row = rowEl.getBoundingClientRect();
      const selection = window.getSelection();
      const rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      combo.pos =
        rect && (rect.left !== 0 || rect.bottom !== 0)
          ? { left: rect.left - row.left, top: rect.top - row.top, height: rect.height }
          : { left: 0, top: 0, height: row.height }; // collapsed-range rect unavailable: fall back to the row
    });
  }

  function pickCombo(option: ComboOption): void {
    if (!el) return;
    const edit = combo.pick(option, draft, caretOffset(el));
    draft = edit.draft;
    if (edit.assignee !== undefined) store.setAssignee(node.id, edit.assignee);
    void caretAfterUpdate(edit.caret);
    refreshHighlights(); // token positions shifted
  }

  /** Colour raw #tokens as "chips in waiting" while editing (no DOM changes). */
  function refreshHighlights(): void {
    // After state-driven text changes the DOM updates on the next flush.
    void tick().then(() => {
      if (el && editing) updateTagHighlights(el, store.meta.tags);
    });
  }

  function onEditableInput(event: Event): void {
    if (event instanceof InputEvent && event.isComposing) return;
    refreshHighlights();
  }

  /**
   * The blank band right of the text is a click target too: clamp the point
   * into the text's box, so a click past a line's end lands the caret at that
   * line's end. Fires only on the content's own background — the text, chips,
   * and badges keep their own pointer behaviour.
   */
  function onContentPointerDown(event: PointerEvent): void {
    if (event.target !== event.currentTarget) return;
    const text = editing ? el : displayEl;
    if (!text) return;
    event.preventDefault();
    store.goalColumn = null;
    const rect = text.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX, rect.left + 1), rect.right - 1);
    const y = Math.min(Math.max(event.clientY, rect.top + 1), rect.bottom - 1);
    if (editing) placeCaretAtPoint(text, x, y);
    else void focusAt(sourceOffsetAt(x, y, text));
  }

  /**
   * Modifier chords on the row, the mouse twins of Mod+. and Mod+Shift+.: the
   * chevron is a 10px target, and these make the whole row one. Each takes a
   * single modifier — Mod collapses, Alt zooms — so neither is a two-hand
   * stretch; holding both is not a third gesture, it's a slip, and does
   * nothing. Shift is excluded throughout, staying with the browser so
   * Shift+click still extends a native text selection.
   */
  function rowChord(event: MouseEvent): "collapse" | "zoom" | null {
    const target = event.target;
    if (target instanceof Element && target.closest(".copy-context, .delete-node")) return null;
    if (event.shiftKey) return null;
    const mod = event.metaKey || event.ctrlKey;
    if (mod === event.altKey) return null; // neither held, or both
    return mod ? "collapse" : "zoom";
  }

  /*
   * Both handlers run in the CAPTURE phase, which is what makes the row a
   * single target: the event is claimed on the way down, so the chevron, the
   * glyph, the priority badge, the tag chips and the link anchors never see it
   * and cannot fire their own action as well. The copy button is explicitly
   * exempt because Mod+click has its own raw-text action.
   * pointerdown's preventDefault is the one that suppresses caret placement and
   * focus — without it the display textbox takes focus and opens an edit
   * underneath the chord.
   */
  function onRowPointerDownCapture(event: PointerEvent): void {
    if (!rowChord(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onRowClickCapture(event: MouseEvent): void {
    const chord = rowChord(event);
    if (!chord) return;
    // preventDefault matters on the inline link segments: Mod+click would open
    // a tab, and Alt+click would download the target.
    event.preventDefault();
    event.stopPropagation();
    if (chord === "zoom") store.zoomIn(node.id);
    else store.toggleCollapse(node.id);
  }

  /** The row buttons must not take focus from the editable: blurring it would end the edit (and, on a phone, unmount the buttons) before the click lands. */
  function keepCaret(event: PointerEvent): void {
    event.preventDefault();
  }

  function onDeleteClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    commit(); // keepCaret means no blur saved the draft; Undo must restore what was typed
    store.deleteSubtree(node.id);
  }

  function onCopyClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey) {
      store.copyNodeText(node.id, currentRawText());
      return;
    }
    commit();
    store.copyNodeContext(node.id);
  }

  /**
   * Parse-on-space: extract a just-typed pN/@human/@agent token in place. #tags stay
   * in the text (they become chips on blur). Commit-time parsing remains the
   * backstop.
   */
  function extractTokenAtCaret(event: KeyboardEvent): void {
    const offset = el ? collapsedCaret(el) : null;
    const hit = offset === null ? null : tokenBeforeCaret(draft, offset);
    if (offset === null || !hit) return;
    event.preventDefault();
    draft = draft.slice(0, hit.start) + draft.slice(offset);
    store.applyToken(node.id, hit.parsed);
    void caretAfterUpdate(hit.start);
    refreshHighlights(); // token positions shifted
  }

  /**
   * Typing `N.` then space at the start of an unnumbered node turns it into a
   * numbered item (the typed N is ignored — core assigns the ordinal). The
   * digits leave the draft the way an extracted token does.
   */
  function startNumbering(event: KeyboardEvent): boolean {
    const offset = el ? collapsedCaret(el) : null;
    if (numbering !== null || offset === null || !/^\d+\.$/.test(draft.slice(0, offset))) return false;
    event.preventDefault();
    draft = draft.slice(offset);
    store.commitText(node.id, withNumbering(draft, 1));
    void caretAfterUpdate(0);
    return true;
  }

  /** Images upload to .kalamu/assets/; a multi-line paste into an empty node splits into siblings. */
  function onPaste(event: ClipboardEvent): void {
    combo.close(); // pasted text would desync the filter
    const files = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => item.getAsFile() ?? []);
    if (files.length > 0) {
      event.preventDefault();
      void pasteImages(files);
      return;
    }
    // Empty node + two or more lines: each line is a sibling of this kind.
    // A non-empty node (or a single line) pastes as ordinary text.
    if (draft !== "" || !store.connected) return;
    const lines = splitPasteLines(event.clipboardData?.getData("text/plain") ?? "");
    const first = lines?.[0];
    if (lines === null || first === undefined) return;
    event.preventDefault();
    // Set draft FIRST: focusing the last new node blurs this editable, and
    // the blur-commit must be a no-op, not a wipe of the first line.
    draft = first;
    store.pasteLines(node.id, lines);
  }

  async function pasteImages(files: File[]): Promise<void> {
    store.showToast(files.length === 1 ? "Uploading image…" : `Uploading ${files.length} images…`);
    for (const file of files) {
      try {
        const asset = await api.uploadAsset(file);
        if (!(await insertToken(`![](${asset.path})`))) {
          // The upload landed in .kalamu/assets/, but there's no draft left to put it in.
          store.showToast("Image uploaded, but editing ended first — paste it again to add it");
          return;
        }
      } catch (err) {
        store.showToast(err instanceof Error ? err.message : "image upload failed");
        return;
      }
    }
    store.showToast(files.length === 1 ? "Image added" : `${files.length} images added`);
  }

  /** Insert `token` at the caret; false when editing ended before it could be. */
  async function insertToken(token: string): Promise<boolean> {
    if (!el) return false;
    const offset = caretOffset(el);
    const before = draft.slice(0, offset);
    const lead = before === "" || before.endsWith(" ") ? "" : " ";
    draft = before + lead + token + draft.slice(offset);
    await caretAfterUpdate(offset + lead.length + token.length);
    refreshHighlights(); // token positions shifted
    return true;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // Disconnected mid-edit: the store refuses mutations anyway, but local
    // draft edits (parse-on-space) must not desync the never-saved text.
    if (!store.connected) return;
    const mod = event.metaKey || event.ctrlKey;

    // Anything other than plain vertical navigation ends a goal-column run.
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") store.goalColumn = null;

    if (combo.kind !== null) {
      const result = combo.handleKey(event);
      if (result === "consumed") return;
      if (result !== "pass") return pickCombo(result.pick);
    }
    // `@` (repo files), `/` (assignees, tasks only) and `#` (tags) at a word
    // boundary open a completion dropdown; the character itself still types —
    // only a pick edits the text. Meta stays excluded, but Ctrl/Alt are allowed
    // for AltGr/Option layouts where they are part of typing the symbol.
    const trigger = COMBO_TRIGGERS[event.key];
    if (combo.kind === null && !event.metaKey && trigger !== undefined) {
      openCombo(trigger);
      return;
    }

    if (event.key === " " && !mod && !event.altKey) {
      if (!startNumbering(event)) extractTokenAtCaret(event); // without a token, the space inserts normally
      return;
    }
    if (matches(event, S.cycleKind)) {
      event.preventDefault();
      commit();
      store.cycleKind(node.id);
      return;
    }
    if (matches(event, S.newSibling)) {
      event.preventDefault();
      if (draft === "") {
        // Never create a sibling below an empty node; cycle its kind instead
        // (outdenting an empty node is Shift+Tab's job).
        store.cycleKind(node.id);
        return;
      }
      const sel = el ? selectionOffsets(el) : null;
      // A collapsed caret at the very end (or an unknowable selection) keeps
      // the old behaviour: empty sibling below, children stay here.
      if (sel === null || (sel.start === sel.end && sel.end >= draft.length)) {
        commit();
        store.createAfter(node.id);
        return;
      }
      // Split at the caret (a real selection is deleted by the split). The
      // children follow the after-text to the new node — it's the
      // continuation. Set draft to the before-half FIRST: focusing the new
      // node blurs this editable, and the blur-commit must be a no-op, not a
      // commit of the full pre-split text.
      const before = draft.slice(0, sel.start);
      const after = draft.slice(sel.end);
      draft = before;
      // The continuation stays in the list: core gives it its ordinal.
      store.splitNode(node.id, fromDraft(before), numbering === null ? after : withNumbering(after, 1));
      return;
    }
    if (matches(event, S.indent) || matches(event, S.outdent)) {
      event.preventDefault();
      const offset = el ? caretOffset(el) : 0;
      commit();
      const moved = event.shiftKey ? store.outdent(node.id) : store.indent(node.id);
      if (moved) void store.focus(node.id, offset);
      return;
    }
    if (matches(event, S.moveUp) || matches(event, S.moveDown)) {
      event.preventDefault();
      const offset = el ? caretOffset(el) : 0;
      if (store.moveBySibling(node.id, matches(event, S.moveUp) ? -1 : 1)) {
        void store.focus(node.id, offset);
      }
      return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !mod && !event.shiftKey && !event.altKey) {
      if (!el) return;
      const up = event.key === "ArrowUp";
      if (up ? caretOnFirstLine(el) : caretOnLastLine(el)) {
        const x = store.goalColumn ?? caretScreenX(el);
        if (store.focusSiblingAtColumn(node.id, up ? -1 : 1, x)) {
          store.goalColumn = x;
          event.preventDefault();
        }
      }
      return;
    }
    if (matches(event, S.deleteSubtree)) {
      event.preventDefault();
      commit();
      store.deleteSubtree(node.id);
      return;
    }
    if (event.key === "Backspace" && !mod && !event.altKey) {
      const atStart = el !== undefined && collapsedCaret(el) === 0;
      // At the start of the text, one press clears the priority back to default.
      if (atStart && node.kind !== "bullet" && node.priority !== undefined) {
        event.preventDefault();
        store.setPriority(node.id, 2);
        return;
      }
      // Then one press drops the numbering (the draft is already the bare body).
      if (atStart && numbering !== null) {
        event.preventDefault();
        store.commitText(node.id, draft);
        return;
      }
      if (draft === "") {
        event.preventDefault();
        store.deleteEmpty(node.id);
        return;
      }
      if (atStart) {
        // Fold into the node above — the inverse of Enter's split. The merge
        // deletes this node, so the blur-commit when focus moves to the
        // target is a no-op (commitText ignores unknown ids).
        event.preventDefault();
        store.mergeIntoPrevious(node.id, draft);
      }
      return;
    }
    if (matches(event, S.copyText)) {
      // Chrome binds this combo to DevTools inspect, but pages may claim it
      // (Google Docs precedent) — preventDefault suffices.
      event.preventDefault();
      store.copyNodeText(node.id, currentRawText());
      return;
    }
    if (matches(event, S.copyContext)) {
      // A real text selection keeps native copy; a collapsed caret copies the
      // node's ancestor path and subtree as agent-chat context.
      if (window.getSelection()?.isCollapsed !== true) return;
      event.preventDefault();
      commit();
      store.copyNodeContext(node.id);
      return;
    }
    if (matches(event, S.redo)) {
      event.preventDefault();
      store.redo();
      return;
    }
    if (matches(event, S.undo)) {
      event.preventDefault();
      store.undo();
      return;
    }
    if (matches(event, S.toggleDone)) {
      event.preventDefault();
      commit();
      store.toggleDone(node.id);
      return;
    }
    if (matches(event, S.toggleCollapse)) {
      event.preventDefault();
      store.toggleCollapse(node.id);
      return;
    }
    if (matches(event, S.collapseParent)) {
      event.preventDefault();
      commit();
      store.collapseParent(node.id);
      return;
    }
    if (matches(event, S.expandChildren)) {
      event.preventDefault();
      commit();
      store.expandChildren(node.id);
      return;
    }
    // zoomOut needs no focused node; it lives in lib/global-keys.ts.
    if (matches(event, S.zoomIn)) {
      event.preventDefault();
      commit();
      store.zoomIn(node.id);
    }
  }
</script>

<!-- Copy and delete: in the row's right gutter, or on phones in the meta row
     of the row holding the caret (the gutter is gone there). A normal click
     copies agent context like Mod+C; Mod+click copies only raw text like
     Mod+Shift+C. Both mappings are uniform across node kinds. The trashcan
     deletes the subtree, undoable (the toast offers Undo), so it asks for no
     confirmation. -->
{#snippet rowActions()}
  <button
    class="copy-context"
    aria-label="Copy item context; modifier-click copies item text only"
    title="Copy item context (Mod-click: copy text only)"
    tabindex="-1"
    onpointerdown={keepCaret}
    onclick={onCopyClick}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  </button>
  <button
    class="delete-node"
    aria-label="Delete item with its subtree"
    title="Delete item (undoable)"
    tabindex="-1"
    onpointerdown={keepCaret}
    onclick={onDeleteClick}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  </button>
{/snippet}

<div class="node" role="listitem" {@attach registerHandle}>
  <!-- Pointer position feeds the progress bar's caption rule (store.captionIds);
       the capture-phase chords are the row's only other pointer behaviour. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class={["row", { done: isDone, caret: editing }]}
    bind:this={rowEl}
    onpointerdowncapture={onRowPointerDownCapture}
    onclickcapture={onRowClickCapture}
    onpointerenter={() => store.setHover(node.id)}
    onpointerleave={() => store.clearHover(node.id)}
  >
    <!-- Browser find-in-page (Cmd/Ctrl+F) matches this; it is not for reading.
         aria-hidden keeps it out of the accessibility tree; transparent text
         plus no pointer events keep it off the layout. Collapsed / filtered
         rows are not in the DOM, so they are not found this way. -->
    <span class="find-id" aria-hidden="true">{store.serverId(node.id)}</span>
    {#if hasChildren}
      <button
        class={["chevron", { closed: isCollapsed }]}
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        tabindex="-1"
        onclick={() => store.toggleCollapse(node.id)}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M5 3.5 11 8l-6 4.5z" fill="currentColor" />
        </svg>
      </button>
    {/if}

    <NodeGlyph {node} {store} ringed={hasChildren && isCollapsed} numbered={numbering !== null} />
    <PriorityPicker {node} {store} />

    <!-- pointer-only widening of the textbox's click target; keyboard users focus the textbox directly -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="content" onpointerdown={onContentPointerDown}>
      {#if numbering !== null}
        <span class="ordinal" aria-hidden="true">{numbering.ordinal}.</span>
      {/if}
      {#if editing}
        <!-- A combobox: the caret pickers (@ files, / assignees, # tags) hang
             off it, with the highlighted option as the active descendant. -->
        <div
          class="text"
          contenteditable="plaintext-only"
          role="combobox"
          tabindex="0"
          aria-label={textLabel}
          aria-describedby={metaId}
          aria-autocomplete="list"
          aria-expanded={comboOpen}
          aria-controls={comboOpen ? comboId : undefined}
          aria-activedescendant={comboOpen ? `${comboId}-${combo.index}` : undefined}
          bind:textContent={() => draft, (value) => (draft = value ?? "")}
          {onkeydown}
          oninput={onEditableInput}
          oncompositionend={refreshHighlights}
          onpaste={onPaste}
          onfocus={onEditableFocus}
          onblur={onEditableBlur}
          onpointerdown={() => {
            store.goalColumn = null;
            combo.close(); // a caret move invalidates the tracked fragment
          }}
          {@attach registerEditable}
        ></div>
        {#if comboOpen && combo.kind !== null && combo.pos !== null}
          <!-- Zero-width anchor over the caret's line; the menu hangs below it (relative to .row) -->
          <span
            class="combo-anchor"
            style:left="{combo.pos.left}px"
            style:top="{combo.pos.top}px"
            style:height="{combo.pos.height}px"
          >
            <Menu
              id={comboId}
              role="listbox"
              options={combo.matches}
              highlighted={combo.index}
              label={COMBO_LABELS[combo.kind]}
              checked={(option) => option.kind === "assign" && option.value === node.assignee}
              onpick={pickCombo}
            >
              {#snippet item(option)}
                {#if option.kind === "assign"}
                  <span class="combo-icon" aria-hidden="true"><AssigneeIcon assignee={option.value} /></span>
                  {ASSIGN_LABELS[option.value]}
                {:else if option.kind === "file"}
                  <span class="combo-name">{basename(option.value)}</span>
                  <span class="combo-path">{option.value}</span>
                {:else}
                  <span class="combo-chip" style:--tag-color={tagColor(option.value, store.meta.tags)}>#{option.value}</span>
                {/if}
              {/snippet}
            </Menu>
          </span>
        {/if}
      {:else}
        <NodeText
          {node}
          {store}
          {segments}
          {label}
          {peeks}
          ariaLabel={textLabel}
          describedby={metaId}
          onfocusat={(target) => void focusAt(target)}
          bind:element={displayEl}
        />
      {/if}

      <!-- Absolute in the row's right gutter and mounted even while editing, so
           entering/leaving edit mode never shifts the row; CSS reveals them on
           row hover/focus. -->
      {#if !phone.current}{@render rowActions()}{/if}
    </div>
  </div>

  <!-- Doc references the reader expanded in place, read-only. -->
  {#each openPeeks as seg (peekKey(seg))}
    <DocPeek path={seg.path} anchor={seg.anchor} />
  {/each}

  <NodeMeta {node} {store} id={metaId} actions={phone.current && editing ? rowActions : undefined} />

  {#if hasChildren && !isCollapsed}
    <div class="children" role="list">
      {#each children as child (child.id)}
        <Self node={child} {store} />
      {/each}
    </div>
  {/if}
</div>

<style>
  /* The gutter every row carries, kept in the pieces it is actually made of so
     one edit moves everything that depends on it. .content — the row's text —
     starts at --text-col, and the meta row lines up with that. --indent is
     one nesting step, row edge to row edge. */
  .node {
    --glyph-col: 18px;
    --prio-col: 27px;
    --prio-gap: 3px;
    --text-col: calc(var(--glyph-col) + var(--prio-col) + var(--prio-gap));
    --indent: 60px;
  }
  /* Phones can't spare a full step per level: a child's checkbox sits under its
     parent's prio column instead, so deep subtrees keep a usable width.
     (Literal breakpoint: see lib/breakpoints.ts.) */
  @media (max-width: 639.98px) {
    .node {
      --indent: 24px;
      /* The priority column costs every row its width, badge or not: on a
         phone it shrinks to the bars' own 11px plus a little air. */
      --prio-col: 16px;
    }
  }

  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    padding: 1px 0;
    border-radius: 4px;
  }
  /* The only place the row itself is tinted: it marks where the caret is.
     Tracks the editable's own focus rather than :focus-within because clicking
     the priority/assignee buttons focuses them in some browsers without ever
     moving the caret into the text. */
  .row.caret {
    background: var(--caret-row);
  }

  /* Present for find-in-page, not for reading. Transparent glyphs still
     receive the browser's find highlight, which paints over the row's text
     column so a pasted id lands on a visible target. */
  .find-id {
    position: absolute;
    left: var(--text-col);
    top: 5px;
    max-width: calc(100% - var(--text-col) - 8px);
    overflow: hidden;
    color: transparent;
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }

  /* Hangs in the outline's chevron gutter, left of the row box. */
  .chevron {
    position: absolute;
    left: calc(1px - var(--chevron-gutter));
    top: 6px;
    width: 15px;
    height: 15px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.1s,
      transform 0.1s;
    transform: rotate(90deg);
  }
  .chevron.closed {
    transform: rotate(0deg);
  }
  /* Shown on hover, on the row holding the caret, and always where there is
     no hover to reveal it (touch). */
  .row:hover .chevron,
  .row.caret .chevron,
  .chevron:focus-visible {
    opacity: 1;
  }
  @media (hover: none) {
    .chevron {
      opacity: 1;
    }
  }

  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 6px;
    cursor: text;
  }

  /* The list ordinal, sized for two digits so 1–99 share one text edge;
     tabular figures keep the dots aligned down the list. */
  .ordinal {
    flex: none;
    min-width: 1.6em;
    padding: 2px 0;
    line-height: 22px;
    text-align: right;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    user-select: none;
  }
  .row.done .ordinal {
    color: var(--done);
  }

  /* Both renderings of the text: the editable here and NodeText's display.
     Monospace for the outline text only — chips, badges and the rest of the
     chrome keep the UI font. */
  .content :global(.text) {
    max-width: 100%;
    min-width: 8px;
    min-height: 22px;
    padding: 2px 0;
    line-height: 22px;
    outline: none;
    word-break: break-word;
    white-space: pre-wrap;
    font-family: var(--font-mono);
    font-size: 13.5px;
  }
  .row.done :global(.text) {
    color: var(--done);
    text-decoration: line-through;
  }

  .combo-anchor {
    position: absolute;
    width: 0;
  }

  /* Option content for the caret combobox. */
  .combo-icon {
    display: flex;
    color: var(--muted);
  }
  /* The name takes the slack, so paths line up on the right. */
  .combo-name {
    flex: 1;
  }
  .combo-path {
    margin-left: 6px;
    color: var(--muted);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* Same recipe as TagChip, so options preview exactly how the tag will chip. */
  .combo-chip {
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    padding: 2.5px 7px;
    border-radius: 999px;
    color: light-dark(color-mix(in oklab, var(--tag-color) 60%, black), color-mix(in oklab, var(--tag-color) 65%, white));
    background: color-mix(in srgb, var(--tag-color) 15%, transparent);
  }

  /* In the row's right gutter (--row-gutter-right, which whatever holds the
     outline leaves clear and every nesting depth keeps — children indent only
     on the left), anchored to .row like the chevron is on the left. Absolute,
     so neither reshapes the row. Copy sits nearest the text, delete 4px
     further out. */
  .copy-context,
  .delete-node {
    position: absolute;
    top: 6px;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
    z-index: 1;
  }
  .copy-context {
    right: -24px;
  }
  .delete-node {
    right: -44px;
  }
  .row:hover :is(.copy-context, .delete-node),
  .row:focus-within :is(.copy-context, .delete-node),
  .copy-context:focus-visible,
  .delete-node:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .copy-context:hover,
  .delete-node:hover {
    color: var(--fg);
  }

  /* Phones: the snippet renders inside NodeMeta's meta row instead, only for
     the row holding the caret — in flow at the row's right end, always shown. */
  @media (max-width: 639.98px) {
    .copy-context,
    .delete-node {
      position: relative;
      top: 0;
      right: 0;
      opacity: 1;
      pointer-events: auto;
    }
  }

  /* Touch: hit areas drawn past the small icons, so the layout is untouched.
     The chevron's stops short of the glyph beside it; copy and delete spread
     across the gutter so theirs don't overlap (24×32 each). */
  @media (pointer: coarse) {
    .chevron::after,
    .copy-context::after,
    .delete-node::after {
      content: "";
      position: absolute;
    }
    .chevron::after {
      inset: -8px -2px -8px -10px;
    }
    .copy-context::after,
    .delete-node::after {
      inset: -8px -4px;
    }
  }
  @media (pointer: coarse) and (min-width: 640px) {
    .copy-context {
      right: -22px;
    }
    .delete-node {
      right: -48px;
    }
  }

  /* Forgiving hover, both sides: approaching a row through either gutter counts
     as hovering it. Left, the chevron renders later, so it stays clickable.
     Right, without this, travelling from the row to the copy and delete
     buttons drops :hover and hides them mid-flight; painted after the row's
     children, so the buttons need their z-index to stay clickable. */
  .row::before,
  .row::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .row::before {
    left: calc(-1 * var(--chevron-gutter));
    width: var(--chevron-gutter);
  }
  .row::after {
    right: calc(-1 * var(--row-gutter-right));
    width: var(--row-gutter-right);
  }

  /* One --indent per level: the guide line sits under the parent's glyph
     centre, and the padding makes up the rest of the step. */
  .children {
    margin-left: calc(var(--glyph-col) / 2 - 1px);
    padding-left: calc(var(--indent) - var(--glyph-col) / 2);
    border-left: 1px solid var(--guide);
  }
</style>
