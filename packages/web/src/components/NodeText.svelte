<!--
  A node's text when it is not being edited (SPEC key decisions 7 and 9): the
  source rendered as segments, with #tags, links, doc and file references and
  images as chips in place. OutlineNode swaps this for its contenteditable on
  focus; `onfocusat` asks it to, with the source offset the reader pointed at.
-->
<script module lang="ts">
  import { caretHit, type CaretPosition } from "../lib/caret";
  import type { DocSegment } from "../lib/segments";

  /** Doc peeks are keyed by `path#anchor`. */
  export const peekKey = (seg: DocSegment): string => `${seg.path}#${seg.anchor ?? ""}`;

  /** Map a point on the rendered text to the equivalent source-text offset. */
  export function sourceOffsetAt(x: number, y: number, display: HTMLElement): CaretPosition {
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
</script>

<script lang="ts">
  import { deriveTags, tagColor, type KalamuNode } from "@kalamu/core";
  import type { SvelteSet } from "svelte/reactivity";
  import { fileRefs } from "../lib/file-refs.svelte";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { assetUrl, basename, docUrl, type FileSegment, type Segment } from "../lib/segments";
  import TagChip from "./TagChip.svelte";

  interface Props {
    node: KalamuNode;
    store: OutlineStore;
    /** What to render: the body, or its overview label. */
    segments: Segment[];
    /** The overview label, or null when the row shows its text in full (see lib/summary.ts). */
    label: string | null;
    /** Doc references expanded under the row, by peekKey; OutlineNode renders them. */
    peeks: SvelteSet<string>;
    ariaLabel: string;
    /** Id of the meta row that describes this node (OutlineNode). */
    describedby: string;
    onfocusat: (target: CaretPosition) => void;
    /** The rendered text element, for the row's own click-to-caret mapping. */
    element?: HTMLElement;
  }

  let { node, store, segments, label, peeks, ariaLabel, describedby, onfocusat, element = $bindable() }: Props = $props();

  /**
   * Tags the summary cut off. They sit at the end of long text more often than
   * not, and are the most scannable thing on a row, so they are re-attached
   * after the clamped text rather than lost with the tail.
   */
  const droppedTags = $derived.by(() => {
    if (label === null) return [];
    const shown = new Set(deriveTags(label));
    return deriveTags(node.text).filter((tag) => !shown.has(tag));
  });

  function togglePeek(event: MouseEvent, seg: DocSegment): void {
    event.preventDefault();
    event.stopPropagation();
    const key = peekKey(seg);
    if (!peeks.delete(key)) peeks.add(key);
  }

  /**
   * A click focuses with the caret at the click point; a drag must instead
   * start a native text selection, so pointerdown cannot preventDefault or
   * focus — the decision is deferred to pointerup. Because the element has
   * tabindex="0", the browser focuses it on pointerdown; `pointerSession`
   * makes the focus handler ignore that (an edit at "start" would destroy the
   * selection mid-drag) while keyboard focus (Tab) still starts an edit.
   */
  let pointerSession = $state(false);
  let downX = 0;
  let downY = 0;

  function onpointerdown(event: PointerEvent): void {
    // Chips handle their own clicks (colour popover / asset link).
    if (event.target instanceof Element && event.target.closest("[data-chip]")) return;
    store.goalColumn = null;
    pointerSession = true;
    downX = event.clientX;
    downY = event.clientY;
  }

  /** Window-level: a selection drag can end outside the element. */
  function onPointerEnd(event: PointerEvent): void {
    pointerSession = false;
    if (event.type === "pointercancel") return;
    const dragged = Math.hypot(event.clientX - downX, event.clientY - downY) > 4;
    // Decide after the browser's own mouseup handling: a click inside an
    // existing selection collapses it only at mouseup, after this listener.
    setTimeout(() => {
      const selected = window.getSelection()?.isCollapsed === false;
      // A drag leaves the native selection alone (for Mod+C / native copy).
      if (!dragged && !selected && element) onfocusat(sourceOffsetAt(downX, downY, element));
    }, 0);
  }
</script>

<!-- A tag chip; `label` is the tag as typed, `name` its lowercase key. -->
{#snippet tagChip(label: string, name: string)}
  <TagChip
    tag={label}
    color={tagColor(name, store.meta.tags)}
    onSetColor={(color) => store.setTagColor(name, color)}
    onFilter={() => store.setFilter(name)}
  />
{/snippet}

<!-- File chip contents, shared by its link and its no-editor button form. Angle
     brackets read as source code — deliberately distinct from the doc chip's page glyph. -->
{#snippet fileChipBody(seg: FileSegment)}
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
    <path d="M6 3.5 2.5 8 6 12.5M10 3.5 13.5 8 10 12.5" stroke="currentColor" stroke-linecap="round" />
  </svg>
  {basename(seg.path)}{seg.line === undefined ? "" : `:${seg.line}`}
{/snippet}

<svelte:window
  onpointerup={pointerSession ? onPointerEnd : undefined}
  onpointercancel={pointerSession ? onPointerEnd : undefined}
/>

<div
  class={["text", "display", { clamped: store.overview }]}
  role="textbox"
  tabindex="0"
  aria-multiline="false"
  aria-label={ariaLabel}
  aria-describedby={describedby}
  title={label === null ? undefined : node.text}
  {onpointerdown}
  onfocus={() => {
    if (!pointerSession) onfocusat("start");
  }}
  bind:this={element}
>
  {#each segments as seg (seg.start)}
    {#if seg.kind === "tag"}
      <span class="chip-slot" data-chip data-start={seg.start} data-length={seg.length}>
        {@render tagChip(seg.label, seg.name)}
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
    {:else if seg.kind === "doc"}
      {@const docLabel = seg.anchor === undefined ? seg.path : `${seg.path}#${seg.anchor}`}
      {@const open = peeks.has(peekKey(seg))}
      <!-- data-chip: the anchor handles its own click (opens the doc), like the image thumb -->
      <span class="chip-slot" data-chip data-start={seg.start} data-length={seg.length}>
        <a class="doc" href={docUrl(seg.path, seg.anchor)} target="_blank" rel="noreferrer" title={docLabel}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
            <path
              d="M4 1.5h5.5L13 5v9a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5Z"
              stroke="currentColor"
            />
            <path d="M9.5 1.5V5H13" stroke="currentColor" />
          </svg>
          {basename(docLabel)}
        </a>
        <button
          type="button"
          class={["peek-toggle", { open }]}
          tabindex="-1"
          aria-expanded={open}
          aria-label="Peek at {docLabel}"
          title="Peek inline"
          onclick={(event) => togglePeek(event, seg)}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </span>
    {:else if seg.kind === "file"}
      {@const href = fileRefs.editorUrl(seg.path, seg.line)}
      <!-- data-chip: the chip handles its own click (hands the file to the
           configured editor, or explains how to configure one) -->
      <span class="chip-slot" data-chip data-start={seg.start} data-length={seg.length}>
        {#if href === null}
          <button
            type="button"
            class="doc file"
            title={seg.path}
            onclick={() => store.showToast("Set an editor to open files: kalamu config editor vscode")}
          >
            {@render fileChipBody(seg)}
          </button>
        {:else}
          <!-- No target=_blank: a custom scheme is an OS handoff, not a page -->
          <a class="doc file" {href} title={seg.path}>
            {@render fileChipBody(seg)}
          </a>
        {/if}
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
  {/each}{#if label !== null}<span class="more">…</span>{/if}
</div>
<!-- Outside the clamped box on purpose: these are the tags the summary cut
     off, and a clamp that could hide them again would defeat them. -->
{#if droppedTags.length > 0}
  <span class="cut-tags">
    {#each droppedTags as tag (tag)}{@render tagChip(tag, tag)}{/each}
  </span>
{/if}

<style>
  /* Overview mode. The summary shortens 96 rows in 118 (see lib/summary.ts) but
     some of what survives is still 265 characters, and a row that is already
     its own summary can be long too — so the two-line clamp is what actually
     bounds the height, and it applies to every row while overview is on. Only
     this rendering: the editable is never clamped. */
  .clamped {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  /* "Something was cut" — chrome, not text. Its span is butted straight against
     {/each} in the markup: .text is pre-wrap, so a newline there would render
     as a real space before the ellipsis. It carries no data-start either, so a
     click on it maps to the end of the FULL text. */
  .more {
    color: var(--muted);
  }

  .cut-tags {
    flex: none;
    align-self: center;
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  /* Chips read as content, not as struck-through text. */
  :global(.row.done) :is(.chip-slot, .cut-tags) {
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

  /* Quiet reference chip for repo docs: muted until hovered, deliberately
     less loud than a tag chip. */
  .doc {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 5px;
    font-size: 12px;
    white-space: nowrap;
    color: var(--muted);
    background: var(--guide);
    text-decoration: none;
  }
  .doc:hover {
    color: var(--fg);
  }
  .doc svg {
    flex: none;
  }
  /* Same chip, rendered as a <button> when no editor is configured. */
  button.doc {
    border: 0;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  /* Expands the referenced section under the row; as quiet as the chip it follows. */
  .peek-toggle {
    display: inline-flex;
    align-items: center;
    padding: 0 2px;
    border: 0;
    background: none;
    color: var(--muted);
    cursor: pointer;
    vertical-align: middle;
  }
  .peek-toggle:hover {
    color: var(--fg);
  }
  .peek-toggle svg {
    transition: transform 120ms;
  }
  .peek-toggle.open svg {
    transform: rotate(180deg);
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
</style>
