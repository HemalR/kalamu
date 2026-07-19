<script lang="ts">
  import { effectivePriority, tagColor, type KalamuNode } from "@kalamu/core";
  import { tick } from "svelte";
  import {
    caretHit,
    caretOffset,
    caretOnFirstLine,
    caretOnLastLine,
    caretScreenX,
    placeCaret,
    placeCaretAtPoint,
    placeCaretAtX,
    selectionOffsets,
    type CaretPosition,
  } from "../lib/caret";
  import { api } from "../lib/api";
  import { tokenBeforeCaret } from "../lib/commit";
  import { writeClipboard } from "../lib/copy";
  import { clearTagHighlights, updateTagHighlights } from "../lib/highlight";
  import type { FocusTarget, OutlineStore } from "../lib/outline.svelte";
  import { assetUrl, segmentText } from "../lib/segments";
  import { matches, SHORTCUTS as S } from "../lib/shortcuts";
  import AssignMenu, { ASSIGNEE_LABELS, assigneeIcon, isAssignee, matchAssignees } from "./AssignMenu.svelte";
  import ComboMenu from "./ComboMenu.svelte";
  import Self from "./OutlineNode.svelte";
  import PriorityMenu from "./PriorityMenu.svelte";
  import TagChip from "./TagChip.svelte";

  interface Props {
    node: KalamuNode;
    store: OutlineStore;
  }

  let { node, store }: Props = $props();

  // The text swaps between two renderings (SPEC key decisions 7 and 9):
  // while editing, a contenteditable shows the raw source text; otherwise a
  // display element renders #tokens as inline chips. The component (keyed by
  // node.id) persists across the swap, and external updates (SSE refetch)
  // never touch the draft or caret while editing.
  let editing = $state(false);
  let draft = $state("");
  let el: HTMLElement | undefined;
  let displayEl: HTMLElement | undefined;

  // Losing the server drops the node back to the display rendering (the
  // editable unmounts, so typing is impossible); focusAt refuses to re-enter
  // editing until the connection returns. The uncommitted draft is discarded —
  // it could not have been saved anyway.
  $effect(() => {
    if (!store.connected && editing) {
      closeCombo();
      editing = false;
      clearTagHighlights();
    }
  });

  let prioOpen = $state(false);
  let prioWrap: HTMLElement | undefined = $state();

  let assignOpen = $state(false);
  let assignWrap: HTMLElement | undefined = $state();
  let rowEl: HTMLElement | undefined;

  const children = $derived(store.visibleChildren(node.id));
  const hasChildren = $derived(children.length > 0);
  const isCollapsed = $derived(store.collapsed.has(node.id));
  const priority = $derived(effectivePriority(node));
  // Done bullets are visual only (strikethrough) — they stay non-work-items.
  const isDone = $derived(node.doneAt !== null);
  const segments = $derived(segmentText(node.text));
  const textLabel = $derived(
    node.kind === "task" ? "Task text" : node.kind === "discussion" ? "Discussion text" : "Bullet text",
  );

  /** Mount the editable (if needed), then place the caret. */
  async function focusAt(target: FocusTarget): Promise<void> {
    if (!editing) {
      if (!store.connected) {
        displayEl?.focus(); // read-only while the server is unreachable
        return;
      }
      draft = node.text;
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

  function registerEditable(element: HTMLElement) {
    el = element;
    return () => {
      if (el === element) el = undefined;
    };
  }

  function registerDisplay(element: HTMLElement) {
    displayEl = element;
    return () => {
      if (displayEl === element) displayEl = undefined;
    };
  }

  /** Full token parsing happens here — on Enter/blur/structural keys, never per keystroke. */
  function commit(): void {
    if (editing) store.commitText(node.id, draft);
  }

  function onEditableFocus(): void {
    store.lastFocusedId = node.id; // the command palette acts on this node
    if (!editing) {
      draft = node.text;
      editing = true;
    }
    refreshHighlights();
  }

  function onEditableBlur(): void {
    closeCombo();
    commit();
    editing = false;
    clearTagHighlights();
  }

  // ---- caret combobox: @ assignees (tasks only) and # tag completion ---------
  // Opens when the trigger is typed at a word boundary; the letters typed
  // after it form a prefix filter. It never edits the text itself — the
  // characters insert natively, and only an explicit pick touches the draft.

  type ComboKind = "assign" | "tag";

  let combo = $state<ComboKind | null>(null);
  let comboFilter = $state("");
  let comboIndex = $state(0);
  /** Menu position relative to the row; null until the caret rect is measured. */
  let comboPos = $state<{ left: number; top: number } | null>(null);
  /** Draft offset of the typed trigger — where a pick edits from. */
  let comboStart = 0;

  function comboOptions(kind: ComboKind, filter: string): string[] {
    if (kind === "assign") return matchAssignees(filter);
    const query = filter.toLowerCase();
    return store.allTags.filter((tag) => tag.toLowerCase().startsWith(query));
  }

  const comboMatches = $derived(combo === null ? [] : comboOptions(combo, comboFilter));

  function closeCombo(): void {
    combo = null;
    comboFilter = "";
    comboIndex = 0;
    comboPos = null;
  }

  /** Open on the trigger keydown when it lands at a word boundary. */
  function maybeOpenCombo(kind: ComboKind): void {
    if (kind === "assign" && node.kind !== "task") return; // bullets have tags, not assignees
    if (comboOptions(kind, "").length === 0) return; // no existing tags: plain typing
    if (!el || window.getSelection()?.isCollapsed !== true) return;
    const offset = caretOffset(el);
    if (offset !== 0 && !/\s/.test(draft.charAt(offset - 1))) return;
    comboStart = offset;
    comboFilter = "";
    comboIndex = 0;
    comboPos = null;
    combo = kind;
    // Measure after the browser inserts the trigger, so the caret rect exists.
    requestAnimationFrame(() => {
      if (combo === null || !rowEl) return;
      const row = rowEl.getBoundingClientRect();
      const selection = window.getSelection();
      const rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      comboPos =
        rect && (rect.left !== 0 || rect.bottom !== 0)
          ? { left: rect.left - row.left, top: rect.bottom - row.top }
          : { left: 0, top: row.height }; // collapsed-range rect unavailable: fall back to the row
    });
  }

  /**
   * Keys while the combobox is open. True = fully consumed here; false =
   * fall through to the normal handling (possibly after closing the menu).
   */
  function handleComboKey(event: KeyboardEvent): boolean {
    if (combo === null) return false;
    const mod = event.metaKey || event.ctrlKey;
    // Bare modifier presses (e.g. Shift for a capital letter) mean nothing here.
    if (event.key === "Shift" || event.key === "Alt" || event.key === "Control" || event.key === "Meta") return true;
    if (event.key === "Escape") {
      event.preventDefault();
      closeCombo(); // leave the text exactly as typed
      return true;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !mod && !event.altKey) {
      event.preventDefault();
      const count = comboMatches.length;
      if (count > 0) comboIndex = (comboIndex + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      return true;
    }
    if (event.key === "Enter" && !mod && !event.shiftKey && !event.altKey) {
      const choice = comboMatches[comboIndex];
      if (choice !== undefined) {
        event.preventDefault();
        pickCombo(choice);
        return true;
      }
      closeCombo();
      return false;
    }
    if (event.key === "Backspace" && !mod && !event.altKey) {
      if (comboFilter === "") closeCombo(); // this press deletes the trigger itself
      else {
        comboFilter = comboFilter.slice(0, -1);
        comboIndex = 0;
      }
      return false; // the deletion happens natively either way
    }
    if (event.key.length === 1 && !mod && !event.altKey) {
      if (event.key !== " " && comboOptions(combo, comboFilter + event.key).length > 0) {
        comboFilter += event.key;
        comboIndex = 0;
        return false; // the character types natively and narrows the filter
      }
      closeCombo(); // space or non-matching character: leave the text as typed
      return false; // a space still falls through to parse-on-space; a new #tag just keeps typing
    }
    // Structural/navigation keys (Tab, mod combos, caret moves…) close it.
    closeCombo();
    return false;
  }

  /**
   * Pick: @ removes the typed `@…` fragment and patches the assignee
   * (metadata); # completes the fragment to the full `#tag` — a pure text
   * edit, the token stays in the text and chips on blur (SPEC key decision 7).
   */
  function pickCombo(choice: string): void {
    if (!el || combo === null) return;
    const kind = combo;
    const offset = caretOffset(el);
    const start = comboStart;
    closeCombo();
    const replacement = kind === "tag" ? `#${choice}` : "";
    draft = draft.slice(0, start) + replacement + draft.slice(offset);
    if (kind === "assign" && isAssignee(choice)) store.setAssignee(node.id, choice);
    const element = el;
    void tick().then(() => placeCaret(element, start + replacement.length));
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

  /** Map a point on the display rendering to the equivalent source-text offset. */
  function sourceOffsetAt(x: number, y: number, display: HTMLElement): CaretPosition {
    const hit = caretHit(x, y, display);
    if (!hit) return "end";
    const container = hit.node instanceof Element ? hit.node : hit.node.parentElement;
    const slot = container?.closest<HTMLElement>("[data-start]");
    if (!slot?.dataset.start) return "end";
    const start = Number(slot.dataset.start);
    // Clicks that land inside a chip map to just after its source token.
    if (slot.dataset.chip !== undefined) return start + Number(slot.dataset.length ?? 0);
    return start + hit.offset;
  }

  /**
   * Pointer interaction with the display rendering: a click focuses with the
   * caret at the click point; a drag must instead start a native text
   * selection, so pointerdown cannot preventDefault or focus — the decision
   * is deferred to pointerup. Because the div has tabindex="0", the browser
   * focuses it on pointerdown; `pointerSession` makes the focus handler
   * ignore that (an edit at "start" would destroy the selection mid-drag)
   * while keyboard focus (Tab) still starts an edit.
   */
  let pointerSession = $state(false);
  let downX = 0;
  let downY = 0;

  function onDisplayPointerDown(event: PointerEvent): void {
    // Chips handle their own clicks (colour popover / asset link).
    if (event.target instanceof Element && event.target.closest("[data-chip]")) return;
    store.goalColumn = null;
    pointerSession = true;
    downX = event.clientX;
    downY = event.clientY;
  }

  /** Window-level: a selection drag can end outside the display element. */
  function onDisplayPointerEnd(event: PointerEvent): void {
    pointerSession = false;
    if (event.type === "pointercancel") return;
    const dragged = Math.hypot(event.clientX - downX, event.clientY - downY) > 4;
    // Decide after the browser's own mouseup handling: a click inside an
    // existing selection collapses it only at mouseup, after this listener.
    setTimeout(() => {
      const selected = window.getSelection()?.isCollapsed === false;
      // A drag leaves the native selection alone (for Mod+C / native copy).
      if (!dragged && !selected && displayEl) void focusAt(sourceOffsetAt(downX, downY, displayEl));
    }, 0);
  }

  function onDisplayFocus(): void {
    if (!pointerSession) void focusAt("start");
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
   * Parse-on-space: extract a just-typed pN/@human/@agent token in place. #tags stay
   * in the text (they become chips on blur). Commit-time parsing remains the
   * backstop.
   */
  function extractTokenAtCaret(event: KeyboardEvent): void {
    if (!el || window.getSelection()?.isCollapsed !== true) return;
    const offset = caretOffset(el);
    const hit = tokenBeforeCaret(draft, offset);
    if (!hit) return;
    event.preventDefault();
    draft = draft.slice(0, hit.start) + draft.slice(offset);
    store.applyToken(node.id, hit.parsed);
    const element = el;
    void tick().then(() => placeCaret(element, hit.start));
    refreshHighlights(); // token positions shifted
  }

  /** Pasted images upload to .kalamu/assets/ and insert their markdown token. */
  function onPaste(event: ClipboardEvent): void {
    closeCombo(); // pasted text would desync the filter
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length === 0) return; // ordinary paste proceeds natively
    event.preventDefault();
    void pasteImages(files);
  }

  async function pasteImages(files: File[]): Promise<void> {
    store.showToast(files.length === 1 ? "Uploading image…" : `Uploading ${files.length} images…`);
    for (const file of files) {
      try {
        const asset = await api.uploadAsset(file);
        await insertToken(`![](${asset.path})`);
      } catch (err) {
        store.showToast(err instanceof Error ? err.message : "image upload failed");
        return;
      }
    }
    store.showToast(files.length === 1 ? "Image added" : `${files.length} images added`);
  }

  async function insertToken(token: string): Promise<void> {
    if (!el) return;
    const offset = caretOffset(el);
    const before = draft.slice(0, offset);
    const lead = before === "" || before.endsWith(" ") ? "" : " ";
    draft = before + lead + token + draft.slice(offset);
    const element = el;
    await tick();
    placeCaret(element, offset + lead.length + token.length);
    refreshHighlights(); // token positions shifted
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // Disconnected mid-edit: the store refuses mutations anyway, but local
    // draft edits (parse-on-space) must not desync the never-saved text.
    if (!store.connected) return;
    const mod = event.metaKey || event.ctrlKey;

    // Anything other than plain vertical navigation ends a goal-column run.
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") store.goalColumn = null;

    if (combo !== null && handleComboKey(event)) return;
    // `@` (tasks only) / `#` at a word boundary opens a completion dropdown;
    // the character itself still types — only a pick edits the text. Meta
    // stays excluded, but Ctrl/Alt are allowed for AltGr/Option layouts where
    // they are part of typing the symbol.
    if (combo === null && !event.metaKey && (event.key === "@" || event.key === "#")) {
      maybeOpenCombo(event.key === "@" ? "assign" : "tag");
      return;
    }

    if (event.key === " " && !mod && !event.altKey) {
      extractTokenAtCaret(event); // without a token, the space inserts normally
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
      store.splitNode(node.id, before, after);
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
      store.deleteSubtree(node.id);
      return;
    }
    if (event.key === "Backspace" && !mod && !event.altKey) {
      const atStart = window.getSelection()?.isCollapsed === true && el !== undefined && caretOffset(el) === 0;
      // At the start of the text, one press clears the priority back to default.
      if (atStart && node.kind !== "bullet" && node.priority !== undefined) {
        event.preventDefault();
        store.setPriority(node.id, 3);
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
    if (matches(event, S.copyId)) {
      // Chrome binds this combo to DevTools inspect, but pages may claim it
      // (Google Docs precedent) — preventDefault suffices.
      event.preventDefault();
      if (node.kind === "discussion") {
        // Keyboard twin of the row's "Copy prompt" link.
        store.copyDiscussionPrompt(node.id);
        return;
      }
      const id = store.serverId(node.id);
      writeClipboard(id).then(
        () => store.showToast(`Copied ${id}`),
        () => store.showToast("could not access the clipboard"),
      );
      return;
    }
    if (matches(event, S.copySubtree)) {
      // A real text selection keeps native copy; a collapsed caret copies the
      // subtree.
      if (window.getSelection()?.isCollapsed !== true) return;
      event.preventDefault();
      commit();
      store.copySubtree(node.id);
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
    // zoomOut needs no focused node; it lives in App's window handler.
    if (matches(event, S.zoomIn)) {
      event.preventDefault();
      commit();
      store.zoomIn(node.id);
    }
  }

  function closeMenusIfOutside(event: PointerEvent): void {
    if (!(event.target instanceof Node)) return;
    if (prioOpen && prioWrap && !prioWrap.contains(event.target)) prioOpen = false;
    if (assignOpen && assignWrap && !assignWrap.contains(event.target)) assignOpen = false;
  }
</script>

<svelte:window
  onpointerdown={prioOpen || assignOpen ? closeMenusIfOutside : undefined}
  onpointerup={pointerSession ? onDisplayPointerEnd : undefined}
  onpointercancel={pointerSession ? onDisplayPointerEnd : undefined}
  onkeydown={prioOpen || assignOpen
    ? (event) => event.key === "Escape" && ((prioOpen = false), (assignOpen = false))
    : undefined}
/>

<div class="node" {@attach registerHandle}>
  <div class={["row", { done: isDone, discussion: node.kind === "discussion" }]} bind:this={rowEl}>
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

    {#if node.kind !== "bullet"}
      {#if node.kind === "task"}
        <button
          class={["glyph", "check", { ringed: hasChildren && isCollapsed }]}
          role="checkbox"
          aria-checked={isDone}
          aria-label={isDone ? "Reopen task" : "Mark task done"}
          tabindex="-1"
          onclick={() => store.toggleDone(node.id)}
        >
          {#if isDone}
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
              <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            </svg>
          {/if}
        </button>
      {:else}
        <!-- Speech bubble in place of the checkbox (SPEC key decision 12); clicking toggles done all the same. -->
        <button
          class={["glyph", "bubble", { ringed: hasChildren && isCollapsed }]}
          role="checkbox"
          aria-checked={isDone}
          aria-label={isDone ? "Reopen discussion" : "Mark discussion done"}
          tabindex="-1"
          onclick={() => store.toggleDone(node.id)}
        >
          <!-- Lucide messages-square, restroked to match the row's other icons; done fills the front bubble, like the filled done checkbox. -->
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
              fill={isDone ? "currentColor" : "none"}
              stroke="currentColor"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"
              fill="none"
              stroke="currentColor"
              stroke-width="2.25"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}

      <!-- Priority column at the row start, so priorities scan vertically. -->
      <span class="prio-wrap" bind:this={prioWrap}>
        <button
          class={["prio", `p${priority}`, { ghost: priority === 3 }]}
          aria-haspopup="menu"
          aria-expanded={prioOpen}
          title="Set priority"
          tabindex="-1"
          onclick={() => (prioOpen = !prioOpen)}
        >
          p{priority}
        </button>
        {#if prioOpen}
          <PriorityMenu
            current={priority}
            onpick={(picked) => {
              store.setPriority(node.id, picked);
              prioOpen = false;
            }}
          />
        {/if}
      </span>
    {:else}
      <!-- The dot doubles as the zoom target (Workflowy-style); task check and
           discussion bubble keep their toggle-done click — keyboard and
           breadcrumbs cover zooming those kinds. -->
      <button
        class={["glyph", "dot", { ringed: hasChildren && isCollapsed }]}
        aria-label="Zoom in"
        title="Zoom in"
        tabindex="-1"
        onclick={() => store.zoomIn(node.id)}
      ></button>
    {/if}

    <!-- pointer-only widening of the textbox's click target; keyboard users focus the textbox directly -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="content" onpointerdown={onContentPointerDown}>
      {#if editing}
        <div
          class="text"
          contenteditable="plaintext-only"
          role="textbox"
          tabindex="0"
          aria-multiline="false"
          aria-label={textLabel}
          bind:textContent={() => draft, (value) => (draft = value ?? "")}
          {onkeydown}
          oninput={onEditableInput}
          oncompositionend={refreshHighlights}
          onpaste={onPaste}
          onfocus={onEditableFocus}
          onblur={onEditableBlur}
          onpointerdown={() => {
            store.goalColumn = null;
            closeCombo(); // a caret move invalidates the tracked fragment
          }}
          {@attach registerEditable}
        ></div>
        {#if combo !== null && comboPos !== null}
          <!-- 0×0 anchor at the caret; the menu hangs below it (relative to .row) -->
          <span class="combo-anchor" style="left: {comboPos.left}px; top: {comboPos.top}px">
            <ComboMenu
              options={comboMatches}
              highlighted={comboIndex}
              label={combo === "assign" ? "Assign" : "Tags"}
              onpick={pickCombo}
            >
              {#snippet item(option)}
                {#if combo === "assign" && isAssignee(option)}
                  <span class="combo-icon" aria-hidden="true">{@render assigneeIcon(option)}</span>
                  <span class="combo-label">{ASSIGNEE_LABELS[option]}</span>
                  {#if node.assignee === option}<span class="combo-tick" aria-hidden="true">✓</span>{/if}
                {:else}
                  <span class="combo-chip" style:--tag-color={tagColor(option, store.meta.tags)}>#{option}</span>
                {/if}
              {/snippet}
            </ComboMenu>
          </span>
        {/if}
      {:else}
        <div
          class="text display"
          role="textbox"
          tabindex="0"
          aria-multiline="false"
          aria-label={textLabel}
          onpointerdown={onDisplayPointerDown}
          onfocus={onDisplayFocus}
          {@attach registerDisplay}
        >
          {#each segments as seg (seg.start)}
            {#if seg.kind === "tag"}
              <span class="chip-slot" data-chip data-start={seg.start} data-length={seg.length}>
                <TagChip
                  tag={seg.label}
                  color={tagColor(seg.name, store.meta.tags)}
                  onSetColor={(color) => store.setTagColor(seg.name, color)}
                  onFilter={() => store.setFilter(seg.name)}
                />
              </span>
            {:else if seg.kind === "link"}
              <!-- data-chip: the anchor handles its own click (opens the URL), like the image thumb;
                   inline (no chip-slot wrapper) so long URLs wrap with the text -->
              <a
                class="link"
                href={seg.href}
                target="_blank"
                rel="noopener noreferrer"
                data-chip
                data-start={seg.start}
                data-length={seg.length}>{seg.href}</a
              >
            {:else if seg.kind === "image"}
              <!-- data-chip: handles its own clicks (opens the asset), like tag chips -->
              <span class="chip-slot" data-chip data-start={seg.start} data-length={seg.length}>
                <a class="thumb" href={assetUrl(seg.path)} target="_blank" rel="noreferrer" title={seg.path}>
                  <img src={assetUrl(seg.path)} alt={seg.alt || "pasted image"} loading="lazy" />
                </a>
              </span>
            {:else}
              <span data-start={seg.start}>{seg.text}</span>
            {/if}
          {/each}
        </div>
      {/if}

      {#if node.assignee}
        {@const assignTitle =
          node.assignee === "human" ? "Assigned to you — agents skip this task" : "Assigned to agents"}
        <span class="assign-wrap" bind:this={assignWrap}>
          <button
            class="assignee"
            aria-haspopup="menu"
            aria-expanded={assignOpen}
            aria-label={assignTitle}
            title={assignTitle}
            tabindex="-1"
            onclick={() => (assignOpen = !assignOpen)}
          >
            {@render assigneeIcon(node.assignee)}
          </button>
          {#if assignOpen}
            <AssignMenu
              current={node.assignee}
              onpick={(picked) => {
                store.setAssignee(node.id, picked);
                assignOpen = false;
              }}
            />
          {/if}
        </span>
      {/if}
      {#if node.handoff}
        <span class="handoff" title={node.handoff.ref}>→ {node.handoff.target}</span>
      {/if}
      {#if node.kind === "discussion"}
        <!-- Absolute in the row's right gutter and mounted even while editing, so
             entering/leaving edit mode never shifts the row; CSS reveals it on
             row hover/focus. Clicking mid-edit blurs the editable, which commits
             the draft before the copy reads the tree. Mod+Shift+C is the keyboard twin. -->
        <button
          class="copy-prompt"
          aria-label="Copy agent prompt"
          title="Copy agent prompt"
          tabindex="-1"
          onclick={() => store.copyDiscussionPrompt(node.id)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  {#if hasChildren && !isCollapsed}
    <div class={["children", { wide: node.kind !== "bullet" }]}>
      {#each children as child (child.id)}
        <Self node={child} {store} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    padding: 1px 0;
    border-radius: 4px;
  }

  .chevron {
    position: absolute;
    left: -17px;
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
  .row:hover .chevron,
  .chevron:focus-visible {
    opacity: 1;
  }

  .glyph {
    flex: none;
    width: 18px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dot {
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
  .dot::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bullet);
  }
  .dot.ringed::before {
    box-shadow: 0 0 0 3.5px var(--ring);
  }
  .dot:hover::before {
    box-shadow: 0 0 0 3.5px var(--ring);
  }

  .check {
    position: relative;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    color: transparent;
  }
  .check::after {
    content: "";
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--check-border);
    border-radius: 3.5px;
    box-sizing: border-box;
  }
  .check.ringed::after {
    box-shadow: 0 0 0 3px var(--ring);
  }
  .check svg {
    position: absolute;
    z-index: 1;
  }
  .row.done .check {
    color: var(--bg);
  }
  .row.done .check::after {
    background: var(--done);
    border-color: var(--done);
  }

  .bubble {
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--check-border);
  }
  .bubble svg {
    border-radius: 4px;
  }
  .bubble.ringed svg {
    box-shadow: 0 0 0 3px var(--ring);
  }
  .row.done .bubble {
    color: var(--done);
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

  .text {
    max-width: 100%;
    min-width: 8px;
    min-height: 22px;
    padding: 2px 0;
    line-height: 22px;
    outline: none;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .row.done .text {
    color: var(--done);
    text-decoration: line-through;
  }
  /* Chips read as content, not as struck-through text. */
  .row.done .chip-slot {
    opacity: 0.6;
  }

  .chip-slot {
    display: inline-block;
    text-decoration: none;
  }

  /* Quiet link: text keeps the row's colour, only the underline marks it. */
  .link {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: var(--muted);
    text-underline-offset: 2px;
  }
  .link:hover {
    text-decoration-color: currentcolor;
  }

  .thumb {
    display: inline-flex;
    vertical-align: middle;
  }
  .thumb img {
    max-height: 120px;
    max-width: 240px;
    object-fit: contain;
    border-radius: 6px;
    border: 1px solid var(--guide);
    color: var(--muted); /* alt-text fallback for missing files */
    font-size: 12px;
  }

  .prio-wrap {
    position: relative;
    flex: none;
    width: 27px;
    height: 26px;
    display: flex;
    align-items: center;
    margin-right: 3px;
  }

  .prio {
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    padding: 2.5px 5px;
    border-radius: 4px;
    background: none;
  }
  .prio.p1 {
    color: var(--p1);
    background: color-mix(in srgb, var(--p1) 14%, transparent);
  }
  .prio.p2 {
    color: var(--p2);
    background: color-mix(in srgb, var(--p2) 14%, transparent);
  }
  .prio.p4,
  .prio.p5 {
    color: var(--muted);
    background: color-mix(in srgb, var(--muted) 12%, transparent);
    font-weight: 500;
  }
  /* Default (p3) shows no badge — only a ghost affordance on hover/focus. */
  .prio.ghost {
    color: var(--muted);
    font-weight: 500;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .row:hover .prio.ghost,
  .row:focus-within .prio.ghost,
  .prio.ghost[aria-expanded="true"] {
    opacity: 0.5;
  }

  .assign-wrap {
    position: relative;
    flex: none;
    align-self: center;
    display: flex;
  }

  .assignee {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border: none;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    color: var(--muted);
    cursor: pointer;
  }
  .assignee:hover,
  .assignee[aria-expanded="true"] {
    color: var(--fg);
  }

  .combo-anchor {
    position: absolute;
    width: 0;
    height: 0;
  }

  /* Option content for the caret combobox (rendered into ComboMenu rows). */
  .combo-icon {
    display: flex;
    color: var(--muted);
  }
  .combo-label {
    flex: 1;
  }
  .combo-tick {
    font-size: 11px;
    color: var(--muted);
  }
  /* Same recipe as TagChip, so options preview exactly how the tag will chip. */
  .combo-chip {
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    padding: 2.5px 7px;
    border-radius: 999px;
    color: var(--tag-color);
    background: color-mix(in srgb, var(--tag-color) 15%, transparent);
  }

  .handoff {
    flex: none;
    align-self: center;
    font-size: 12px;
    color: var(--muted);
  }

  /* In the row's right gutter (main's 32px right padding, which every nesting
     depth keeps — children indent only on the left), anchored to .row like the
     chevron is on the left. Absolute, so it never reshapes the row. */
  .copy-prompt {
    position: absolute;
    right: -24px;
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
  }
  .row:hover .copy-prompt,
  .row:focus-within .copy-prompt,
  .copy-prompt:focus-visible {
    opacity: 1;
    pointer-events: auto;
  }
  .copy-prompt:hover {
    color: var(--fg);
  }
  /* Forgiving hover: approaching a discussion row through the left gutter
     counts as hovering the row (the row box already spans the full column
     width on the right). The chevron renders later, so it stays clickable. */
  .row.discussion::before {
    content: "";
    position: absolute;
    left: -20px;
    top: 0;
    bottom: 0;
    width: 20px;
  }

  .children {
    margin-left: 8px;
    padding-left: 21px;
    border-left: 1px solid var(--guide);
  }
  /* Task/discussion rows start their text after the prio column (27px +
     3px margin); indent children the same 30px so their bullets sit under
     the parent's text, as they do under bullet parents. */
  .children.wide {
    padding-left: 51px;
  }
</style>
