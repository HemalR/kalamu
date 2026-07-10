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
    type CaretPosition,
  } from "../lib/caret";
  import { api } from "../lib/api";
  import { tokenBeforeCaret } from "../lib/commit";
  import { writeClipboard } from "../lib/copy";
  import { clearTagHighlights, updateTagHighlights } from "../lib/highlight";
  import type { FocusTarget, OutlineStore } from "../lib/outline.svelte";
  import { assetUrl, segmentText } from "../lib/segments";
  import { matches, SHORTCUTS as S } from "../lib/shortcuts";
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

  let prioOpen = $state(false);
  let prioWrap: HTMLElement | undefined = $state();

  const children = $derived(store.visibleChildren(node.id));
  const hasChildren = $derived(children.length > 0);
  const isCollapsed = $derived(store.collapsed.has(node.id));
  const priority = $derived(effectivePriority(node));
  const isDone = $derived(node.kind === "task" && node.doneAt !== null);
  const segments = $derived(segmentText(node.text));

  /** Mount the editable (if needed), then place the caret. */
  async function focusAt(target: FocusTarget): Promise<void> {
    if (!editing) {
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
    commit();
    editing = false;
    clearTagHighlights();
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
   * Parse-on-space: extract a just-typed pN/@me token in place. #tags stay
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
    const mod = event.metaKey || event.ctrlKey;

    // Anything other than plain vertical navigation ends a goal-column run.
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") store.goalColumn = null;

    if (event.key === " " && !mod && !event.altKey) {
      extractTokenAtCaret(event); // without a token, the space inserts normally
      return;
    }
    if (matches(event, S.toggleKind)) {
      event.preventDefault();
      commit();
      store.toggleKind(node.id);
      return;
    }
    if (matches(event, S.newSibling)) {
      event.preventDefault();
      if (draft === "") {
        // Never create a sibling below an empty node; toggle its kind instead
        // (outdenting an empty node is Shift+Tab's job).
        store.toggleKind(node.id);
        return;
      }
      commit();
      store.createAfter(node.id);
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
      if (atStart && node.kind === "task" && node.priority !== undefined) {
        event.preventDefault();
        store.setPriority(node.id, 3);
        return;
      }
      if (draft === "") {
        event.preventDefault();
        store.deleteEmpty(node.id);
      }
      return;
    }
    if (matches(event, S.copyId)) {
      // Chrome binds this combo to DevTools inspect, but pages may claim it
      // (Google Docs precedent) — preventDefault suffices.
      event.preventDefault();
      const id = store.serverId(node.id);
      writeClipboard(id).then(
        () => store.showToast(`Copied ${id}`),
        () => store.showToast("could not access the clipboard"),
      );
      return;
    }
    if (matches(event, S.copySubtree)) {
      // A real text selection keeps native copy; a collapsed caret copies the subtree.
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
    }
  }

  function closePrioIfOutside(event: PointerEvent): void {
    if (prioWrap && event.target instanceof Node && !prioWrap.contains(event.target)) prioOpen = false;
  }
</script>

<svelte:window
  onpointerdown={prioOpen ? closePrioIfOutside : undefined}
  onpointerup={pointerSession ? onDisplayPointerEnd : undefined}
  onpointercancel={pointerSession ? onDisplayPointerEnd : undefined}
  onkeydown={prioOpen ? (event) => event.key === "Escape" && (prioOpen = false) : undefined}
/>

<div class="node" {@attach registerHandle}>
  <div class={["row", { done: isDone }]}>
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
      <span class={["glyph", "dot", { ringed: hasChildren && isCollapsed }]} aria-hidden="true"></span>
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
          aria-label={node.kind === "task" ? "Task text" : "Bullet text"}
          bind:textContent={() => draft, (value) => (draft = value ?? "")}
          {onkeydown}
          oninput={onEditableInput}
          oncompositionend={refreshHighlights}
          onpaste={onPaste}
          onfocus={onEditableFocus}
          onblur={onEditableBlur}
          onpointerdown={() => (store.goalColumn = null)}
          {@attach registerEditable}
        ></div>
      {:else}
        <div
          class="text display"
          role="textbox"
          tabindex="0"
          aria-multiline="false"
          aria-label={node.kind === "task" ? "Task text" : "Bullet text"}
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

      {#if node.self}
        <span class="me" title="Kept for yourself — agents skip this task">me</span>
      {/if}
      {#if node.handoff}
        <span class="handoff" title={node.handoff.ref}>→ {node.handoff.target}</span>
      {/if}
    </div>
  </div>

  {#if hasChildren && !isCollapsed}
    <div class="children">
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

  .me {
    flex: none;
    align-self: center;
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    padding: 2.5px 6px;
    border-radius: 999px;
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }

  .handoff {
    flex: none;
    align-self: center;
    font-size: 12px;
    color: var(--muted);
  }

  .children {
    margin-left: 8px;
    padding-left: 21px;
    border-left: 1px solid var(--guide);
  }
</style>
