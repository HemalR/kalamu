<script lang="ts">
  /**
   * Self-contained hero demo of the Kalamu outliner. Pure local state (runes) —
   * no server, no persistence, resets on reload. Visual language matches the
   * real app (packages/web/src/components/OutlineNode.svelte) but this is a
   * deliberately lightweight approximation: flat rows with a depth number
   * instead of a real tree, no undo, no drag, no @-assignee combobox.
   */

  import { tick } from "svelte";
  import { SvelteSet } from "svelte/reactivity";

  type Kind = "task" | "bullet" | "discussion";
  type Assignee = "human" | "agent";
  type Priority = 1 | 2 | 4 | 5; // p3 is the default and is never stored

  interface Row {
    id: string;
    kind: Kind;
    depth: number;
    text: string;
    done: boolean;
    priority?: Priority;
    assignee?: Assignee;
  }

  function makeId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `row-${Math.random().toString(36).slice(2)}`;
  }

  let rows = $state<Row[]>([
    {
      id: makeId(),
      kind: "task",
      depth: 0,
      text: "Ship the landing page hero #marketing",
      done: false,
      priority: 2,
    },
    {
      id: makeId(),
      kind: "task",
      depth: 1,
      text: "Wire up the interactive outline demo #svelte",
      done: true,
    },
    {
      id: makeId(),
      kind: "task",
      depth: 1,
      text: "Write the section 2 copy",
      done: false,
      assignee: "human",
    },
    {
      id: makeId(),
      kind: "task",
      depth: 0,
      text: "Fix flaky CI test #bug",
      done: false,
      priority: 1,
      assignee: "agent",
    },
    {
      id: makeId(),
      kind: "discussion",
      depth: 0,
      text: "Naming for the v0.7 release",
      done: false,
    },
    {
      id: makeId(),
      kind: "bullet",
      depth: 1,
      text: "kalamu vs kalam vs outlinr #naming",
      done: false,
    },
    {
      id: makeId(),
      kind: "task",
      depth: 0,
      text: "Buy coffee",
      done: true,
      priority: 5,
    },
  ]);

  const collapsed = new SvelteSet<string>();

  let editingId = $state<string | null>(null);
  let pendingFocus = $state<{ id: string; caret: "start" | "end" } | null>(null);

  const TAG_PALETTE = ["#e5484d", "#f76b15", "#3b82f6", "#10b981", "#a855f7", "#0ea5e9"];

  function tagColor(tag: string): string {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
    return TAG_PALETTE[hash % TAG_PALETTE.length]!;
  }

  type Segment = { kind: "text"; value: string } | { kind: "tag"; value: string };

  /** Simplified, regex-only tag rendering — no caret-preserving segment logic. */
  function segments(text: string): Segment[] {
    const result: Segment[] = [];
    const re = /#([a-zA-Z][\w-]*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      if (match.index > lastIndex) result.push({ kind: "text", value: text.slice(lastIndex, match.index) });
      result.push({ kind: "tag", value: match[1]! });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) result.push({ kind: "text", value: text.slice(lastIndex) });
    return result;
  }

  interface VisibleRow {
    row: Row;
    index: number;
    hasChildren: boolean;
  }

  /** Flattens rows into what's visible given `collapsed`, computing each row's hasChildren along the way. */
  const visibleRows = $derived.by<VisibleRow[]>(() => {
    const result: VisibleRow[] = [];
    let hideBelowDepth: number | null = null;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      if (hideBelowDepth !== null) {
        if (row.depth > hideBelowDepth) continue;
        hideBelowDepth = null;
      }
      const hasChildren = i + 1 < rows.length && rows[i + 1]!.depth > row.depth;
      result.push({ row, index: i, hasChildren });
      if (hasChildren && collapsed.has(row.id)) hideBelowDepth = row.depth;
    }
    return result;
  });

  function subtreeEnd(index: number): number {
    const depth = rows[index]!.depth;
    let end = index + 1;
    while (end < rows.length && rows[end]!.depth > depth) end++;
    return end - 1;
  }

  function enterEdit(id: string): void {
    if (editingId === id) return;
    editingId = id;
    pendingFocus = { id, caret: "end" };
  }

  function insertSiblingAfter(row: Row, index: number): void {
    const sibling: Row = { id: makeId(), kind: row.kind, depth: row.depth, text: "", done: false };
    // Insert after the row's whole subtree, not right after the row itself —
    // otherwise the new same-depth row would land in front of the row's own
    // depth+1 children and visually adopt them (see subtreeEnd).
    rows.splice(subtreeEnd(index) + 1, 0, sibling);
    editingId = sibling.id;
    pendingFocus = { id: sibling.id, caret: "start" };
  }

  function indent(index: number): void {
    const row = rows[index]!;
    if (index === 0 || rows[index - 1]!.depth < row.depth) return; // no row above to become a parent
    const end = subtreeEnd(index);
    for (let k = index; k <= end; k++) rows[k]!.depth += 1;
  }

  function outdent(index: number): void {
    const row = rows[index]!;
    if (row.depth === 0) return;
    const end = subtreeEnd(index);
    for (let k = index; k <= end; k++) rows[k]!.depth -= 1;
  }

  function deleteEmptyRow(index: number): void {
    const prev = rows[index - 1];
    rows.splice(index, 1);
    if (prev) {
      editingId = prev.id;
      pendingFocus = { id: prev.id, caret: "end" };
    } else {
      editingId = null;
    }
  }

  function toggleDone(row: Row): void {
    row.done = !row.done;
  }

  function toggleCollapse(id: string): void {
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
  }

  function onRowKeydown(event: KeyboardEvent, row: Row, index: number, hasChildren: boolean): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insertSiblingAfter(row, index);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey) outdent(index);
      else indent(index);
      return;
    }
    if (event.key === "Backspace" && row.text === "" && !hasChildren && rows.length > 1) {
      event.preventDefault();
      deleteEmptyRow(index);
    }
  }

  function placeCaret(node: HTMLElement, position: "start" | "end"): void {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(position === "start");
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /**
   * Focuses + places the caret once, when the row this was requested for
   * mounts. Deferred a tick past the current DOM patch: inserting/removing a
   * row (Enter, Backspace-merge) swaps another row's contenteditable out of
   * the DOM in the same update, and removing a *currently focused* element
   * resets the browser's focus to <body> as part of that removal — which
   * would otherwise land after this attachment's own focus() call and steal
   * it right back. Waiting for `tick()` lets that patch fully settle first.
   */
  function focusWhenPending(id: string) {
    return (node: HTMLElement) => {
      if (pendingFocus?.id !== id) return;
      const caret = pendingFocus.caret;
      pendingFocus = null;
      void tick().then(() => {
        node.focus();
        placeCaret(node, caret);
      });
    };
  }

  const KIND_LABEL: Record<Kind, string> = { task: "Task text", bullet: "Bullet text", discussion: "Discussion text" };
</script>

<div class="card">
  <div class="window-bar" aria-hidden="true">
    <span class="dot-control"></span>
    <span class="dot-control"></span>
    <span class="dot-control"></span>
    <span class="window-title">demo.outline — click a line, try Enter / Tab</span>
  </div>

  <div class="outline">
    {#each visibleRows as { row, index, hasChildren } (row.id)}
      <div class="row" class:done={row.done} style:padding-left="{2 + row.depth * 20}px">
        {#each { length: row.depth } as _, level (level)}
          <span class="guide" aria-hidden="true"></span>
        {/each}

        {#if hasChildren}
          <button
            type="button"
            class={["chevron", { closed: collapsed.has(row.id) }]}
            aria-expanded={!collapsed.has(row.id)}
            aria-label={collapsed.has(row.id) ? "Expand" : "Collapse"}
            onclick={() => toggleCollapse(row.id)}
          >
            <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
              <path d="M5 3.5 11 8l-6 4.5z" fill="currentColor" />
            </svg>
          </button>
        {:else}
          <span class="chevron-spacer" aria-hidden="true"></span>
        {/if}

        {#if row.kind === "bullet"}
          <span class="glyph dot" aria-hidden="true"></span>
        {:else}
          <button
            type="button"
            class="glyph"
            role="checkbox"
            aria-checked={row.done}
            aria-label={row.done ? `Reopen ${row.kind}` : `Mark ${row.kind} done`}
            onclick={() => toggleDone(row)}
          >
            {#if row.kind === "task"}
              <span class="checkbox">
                {#if row.done}
                  <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
                    <path
                      d="M3 8.5 6.5 12 13 4.5"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.2"
                      stroke-linecap="round"
                    />
                  </svg>
                {/if}
              </span>
            {:else}
              <svg class="bubble" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  d="M4 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3.5V16a2 2 0 0 1-2-2V6a2 2 0 0 1 1-1.7Z"
                  fill={row.done ? "currentColor" : "none"}
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linejoin="round"
                />
              </svg>
            {/if}
          </button>

          <span class="prio-slot">
            {#if row.priority}
              <span class="prio-badge p{row.priority}">p{row.priority}</span>
            {/if}
          </span>
        {/if}

        <div class="content">
          {#if editingId === row.id}
            <div
              class="text edit"
              contenteditable="plaintext-only"
              role="textbox"
              tabindex="0"
              aria-multiline="false"
              aria-label={KIND_LABEL[row.kind]}
              bind:textContent={() => row.text, (value) => (row.text = value ?? "")}
              onkeydown={(event) => onRowKeydown(event, row, index, hasChildren)}
              onblur={() => {
                // Guarded: removing this row from the DOM (Enter's new sibling,
                // Backspace's merge) fires a native blur here too, after
                // `editingId` has already moved on to another row — an
                // unconditional reset would stomp that reassignment back to null.
                if (editingId === row.id) editingId = null;
              }}
              {@attach focusWhenPending(row.id)}
            ></div>
          {:else}
            <div
              class="text display"
              role="textbox"
              tabindex="0"
              aria-multiline="false"
              aria-label={KIND_LABEL[row.kind]}
              onfocus={() => enterEdit(row.id)}
            >
              {#each segments(row.text) as seg, i (i)}
                {#if seg.kind === "tag"}
                  <span class="chip" style:--chip-color={tagColor(seg.value)}>#{seg.value}</span>
                {:else}
                  {seg.value}
                {/if}
              {/each}
            </div>
          {/if}

          {#if row.assignee}
            <span class="assignee" title={row.assignee === "human" ? "Assigned to you" : "Assigned to agents"}>
              {#if row.assignee === "human"}
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <circle cx="8" cy="5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4" />
                  <path
                    d="M2.5 14c.7-3 3-4.6 5.5-4.6s4.8 1.6 5.5 4.6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                  />
                </svg>
              {:else}
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                  <rect x="2.5" y="4.5" width="11" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" />
                  <circle cx="6" cy="8.5" r="1" fill="currentColor" />
                  <circle cx="10" cy="8.5" r="1" fill="currentColor" />
                  <path d="M8 4.5V2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
                </svg>
              {/if}
            </span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .card {
    position: relative;
    width: 100%;
    max-width: 440px;
    border-radius: 12px;
    border: 1px solid var(--guide);
    background: var(--panel);
    box-shadow: 0 24px 48px -28px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .window-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--guide);
  }

  .dot-control {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--muted);
    opacity: 0.45;
  }

  .window-title {
    margin-left: 6px;
    font-size: 11.5px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .outline {
    padding: 10px 10px 12px;
    display: flex;
    flex-direction: column;
  }

  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    border-radius: 6px;
    padding-top: 2px;
    padding-bottom: 2px;
    padding-right: 4px;
  }

  .row:hover {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }

  .guide {
    flex: none;
    align-self: stretch;
    width: 20px;
    margin-left: -20px;
    border-left: 1px solid var(--guide);
  }

  .chevron,
  .chevron-spacer {
    flex: none;
    width: 16px;
    height: 22px;
  }

  .chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    opacity: 0.55;
    transform: rotate(90deg);
    transition:
      opacity 0.1s,
      transform 0.1s;
  }
  .chevron:hover {
    opacity: 1;
  }
  .chevron.closed {
    transform: rotate(0deg);
  }

  .glyph {
    flex: none;
    width: 18px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--check-border);
  }

  .dot::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bullet);
  }

  .checkbox {
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border: 1.5px solid var(--check-border);
    border-radius: 3.5px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg);
  }
  .row.done .checkbox {
    background: var(--done);
    border-color: var(--done);
  }

  .bubble {
    border-radius: 4px;
  }
  .row.done .bubble {
    color: var(--done);
  }

  .prio-slot {
    flex: none;
    width: 28px;
    height: 22px;
    display: flex;
    align-items: center;
  }

  .prio-badge {
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1;
    padding: 2.5px 5px;
    border-radius: 4px;
  }
  .prio-badge.p1 {
    color: var(--p1);
    background: color-mix(in srgb, var(--p1) 16%, transparent);
  }
  .prio-badge.p2 {
    color: var(--p2);
    background: color-mix(in srgb, var(--p2) 16%, transparent);
  }
  .prio-badge.p4,
  .prio-badge.p5 {
    color: var(--muted);
    background: color-mix(in srgb, var(--muted) 14%, transparent);
    font-weight: 500;
  }

  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: 6px;
  }

  .text {
    flex: 1;
    min-width: 40px;
    min-height: 22px;
    padding: 1px 0;
    line-height: 22px;
    outline: none;
    word-break: break-word;
    white-space: pre-wrap;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 13px;
  }
  .text.display {
    cursor: text;
  }
  .row.done .text {
    color: var(--done);
    text-decoration: line-through;
  }
  .row.done .chip {
    opacity: 0.6;
  }

  .chip {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    padding: 2.5px 7px;
    border-radius: 999px;
    color: var(--chip-color);
    background: color-mix(in srgb, var(--chip-color) 16%, transparent);
    text-decoration: none;
  }

  .assignee {
    flex: none;
    align-self: center;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    color: var(--muted);
  }
</style>
