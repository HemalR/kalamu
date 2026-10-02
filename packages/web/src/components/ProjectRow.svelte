<!--
  One project in the hub sidebar: colour swatch (with its popover), the link,
  and the hover rename/remove buttons — or the inline rename input. The row is
  the drag source for reordering; the list (Sidebar) owns the drag and the
  drop line, the row only reports which half of itself the pointer is over.
-->
<script lang="ts">
  import type { Attachment } from "svelte/attachments";
  import type { HubProject } from "../lib/hub";
  import { dismissable } from "../lib/popover";
  import ColorPopover from "./ColorPopover.svelte";

  type DragHandler = (event: DragEvent, below: boolean) => void;

  interface Props {
    project: HubProject;
    /** Registry position; the first nine carry their Mod+K digit. */
    index: number;
    active: boolean;
    renaming: boolean;
    dragging: boolean;
    /** Where the drop line sits on this row, if anywhere. */
    dropEdge: "before" | "after" | null;
    onrenamestart: () => void;
    /** The draft to save (the server trims; blank clears), or null to cancel. */
    onrenameend: (name: string | null) => void;
    /** A palette hex, or null back to the derived colour. */
    oncolor: (color: string | null) => void;
    onremove: () => void;
    ondragstart: (event: DragEvent) => void;
    ondragover: DragHandler;
    ondrop: DragHandler;
    ondragend: () => void;
  }

  let {
    project,
    index,
    active,
    renaming,
    dragging,
    dropEdge,
    onrenamestart,
    onrenameend,
    oncolor,
    onremove,
    ondragstart,
    ondragover,
    ondrop,
    ondragend,
  }: Props = $props();

  let colorOpen = $state(false);
  let draft = $state("");
  const numbered = $derived(index < 9);

  const focusAndSelect: Attachment<HTMLInputElement> = (input) => {
    input.focus();
    input.select();
  };

  /** Before/after this row, split at its vertical midpoint. */
  function below(event: DragEvent & { currentTarget: HTMLElement }): boolean {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      onrenameend(draft);
    } else if (event.key === "Escape") {
      event.preventDefault(); // handled: popovers and the outline's Escape cascade skip it
      onrenameend(null);
    }
  }
</script>

<!-- The li is the drag source (the anchor opts out with draggable="false",
     clicks are unaffected), so the payload is the slug — not a link drag
     that browsers would treat as a URL drop. -->
<li
  draggable={!renaming}
  class={{ dragging, "drop-before": dropEdge === "before", "drop-after": dropEdge === "after" }}
  ondragstart={(event) => {
    colorOpen = false; // a drag and an open popover don't mix
    ondragstart(event);
  }}
  ondragover={(event) => ondragover(event, below(event))}
  ondrop={(event) => ondrop(event, below(event))}
  {ondragend}
  {@attach colorOpen && dismissable(() => (colorOpen = false))}
>
  {#if renaming}
    <input
      class="rename"
      type="text"
      bind:value={draft}
      aria-label={`New name for ${project.name}`}
      onkeydown={onRenameKeydown}
      onblur={() => onrenameend(draft)}
      {@attach focusAndSelect}
    />
  {:else}
    <button
      class={["swatch", { numbered }]}
      style:--swatch-color={project.color}
      aria-haspopup="dialog"
      aria-expanded={colorOpen}
      aria-label={`Change colour of ${project.name}`}
      title="Change colour"
      onclick={() => (colorOpen = !colorOpen)}
    >{#if numbered}<span aria-hidden="true">{index + 1}</span>{/if}</button>
    <a
      href={`/p/${project.slug}`}
      draggable="false"
      class={{ active, missing: project.missing }}
      aria-current={active ? "page" : undefined}
      title={project.missing ? `Outline file missing — expected at ${project.path}/.kalamu/outline.jsonl` : project.path}
    >
      <span class="name">{project.name}</span>
      {#if project.openTasks !== null && project.openTasks > 0}
        <span class="count">{project.openTasks}</span>
      {/if}
    </a>
    <button
      class="edit"
      aria-label={`Rename ${project.name}`}
      title="Rename"
      onclick={() => {
        draft = project.name;
        onrenamestart();
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    </button>
    <button
      class="remove"
      aria-label={`Remove ${project.name} from sidebar`}
      title="Remove from sidebar (project data is untouched)"
      onclick={onremove}
    >×</button>
    {#if colorOpen}
      <ColorPopover
        color={project.color}
        onpick={(picked) => {
          colorOpen = false;
          oncolor(picked);
        }}
      />
    {/if}
  {/if}
</li>

<style>
  /* Hover target for the row: anchor and buttons are siblings. */
  li {
    position: relative;
  }

  /* Row being dragged: ghosted, so the drop line reads as its destination. */
  li.dragging {
    opacity: 0.4;
  }
  /* 2px drop line in the sidebar's accent, riding the seam between rows. */
  li.drop-before::before,
  li.drop-after::after {
    content: "";
    position: absolute;
    left: 6px;
    right: 6px;
    height: 2px;
    border-radius: 1px;
    background: var(--project-color, var(--fg));
    pointer-events: none;
  }
  li.drop-before::before {
    top: -1px;
  }
  li.drop-after::after {
    bottom: -1px;
  }

  a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px 5px 34px; /* room for the numbered swatch */
    border-radius: 6px;
    font-size: 13.5px;
    color: var(--muted);
    text-decoration: none;
  }
  /* li:hover (not a:hover) so the row stays lit while pointing at the ×.
     Hover-capable pointers only: a touch screen's sticky :hover after a tap
     would otherwise light rows (and reveal buttons) nobody pointed at. */
  @media (hover: hover) {
    li:hover a {
      background: var(--guide);
      color: var(--fg);
    }
  }
  /* Active row in the project's colour — the tag-chip pattern (colour text
     over a 15% tint), so it stays legible in both themes. */
  a.active,
  li:hover a.active {
    background: color-mix(in srgb, var(--project-color, var(--fg)) 15%, transparent);
    color: var(--project-color, var(--fg));
    font-weight: 500;
  }
  @media (hover: hover) {
    li:hover a.active {
      background: color-mix(in srgb, var(--project-color, var(--fg)) 22%, transparent);
    }
  }

  /* Outline file gone: the row stays (its path is the lead for recovery —
     see the tooltip) but reads as a ghost rather than a project to open. */
  a.missing .name {
    opacity: 0.45;
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, currentColor 50%, transparent);
  }

  /* Per-row colour, always visible; a quiet halo marks it as clickable. */
  .swatch {
    position: absolute;
    top: 50%;
    left: 10px;
    transform: translateY(-50%);
    width: 9px;
    height: 9px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch-color);
    cursor: pointer;
  }
  .swatch:hover,
  .swatch:focus-visible {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--swatch-color) 30%, transparent);
  }
  /* First nine rows: a kbd-like square whose digit is the Mod+K digit —
     colour text over a tint (the tag-chip pattern), so the project colour
     stays tellable in both themes. Rows 10+ keep the dot. */
  .swatch.numbered {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid color-mix(in srgb, var(--swatch-color) 45%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--swatch-color) 15%, transparent);
    color: var(--swatch-color);
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex-shrink: 0;
    font-size: 11px;
    line-height: 1;
    padding: 3px 7px;
    border-radius: 999px;
    color: var(--muted-strong);
    background: var(--guide);
  }

  .edit,
  .remove {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    padding: 1px 6px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 14px;
    line-height: 1.2;
    color: var(--muted);
    cursor: pointer;
    /* Hidden means untouchable too: an invisible × over the count badge
       once unregistered a project from a tap on the count. */
    opacity: 0;
    pointer-events: none;
  }
  .remove {
    right: 6px;
  }
  .edit {
    right: 26px;
    display: flex;
    align-items: center;
    padding: 3px 4px;
  }
  /* Revealed on hover, on keyboard focus, and — where nothing hovers — on
     the active project's row (rename or remove another by opening it first).
     The buttons replace the count while they're showing. */
  .edit:focus-visible,
  .remove:focus-visible,
  li:has(.edit:focus-visible, .remove:focus-visible) :is(.edit, .remove) {
    opacity: 1;
    pointer-events: auto;
  }
  li:has(.edit:focus-visible, .remove:focus-visible) .count {
    visibility: hidden;
  }
  @media (hover: hover) {
    li:hover :is(.edit, .remove) {
      opacity: 1;
      pointer-events: auto;
    }
    li:hover .count {
      visibility: hidden;
    }
  }
  @media (hover: none) {
    li:has(a.active) :is(.edit, .remove) {
      opacity: 1;
      pointer-events: auto;
    }
    li:has(a.active) .count {
      visibility: hidden;
    }
  }
  .edit:hover,
  .remove:hover {
    color: var(--fg);
  }

  /* Touch: taller rows, and 32px targets for the swatch and the buttons. */
  @media (pointer: coarse) {
    a {
      padding-block: 9px;
    }
    .swatch::after {
      content: "";
      position: absolute;
      inset: -8px;
    }
    .edit,
    .remove {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 32px;
      min-height: 32px;
    }
    .remove {
      right: 2px;
    }
    .edit {
      right: 36px;
    }
  }

  /* Sits where the anchor was, in the anchor's hover/active tone. */
  .rename {
    width: 100%;
    padding: 5px 10px 5px 34px;
    border: none;
    border-radius: 6px;
    background: var(--guide);
    font: inherit;
    font-size: 13.5px;
    color: var(--fg);
  }
  .rename:focus {
    outline: none;
  }
</style>
