<script lang="ts">
  /**
   * Hub-mode project list (rendered only when the app is served under
   * /p/<slug>). Entries are plain links on purpose: each project gets a
   * fresh app instance, so navigation is a full page load.
   */
  import type { Attachment } from "svelte/attachments";
  import { apiBase } from "../lib/api";
  import ColorPopover from "./ColorPopover.svelte";
  import Wordmark from "./Wordmark.svelte";

  interface HubProject {
    slug: string;
    name: string;
    path: string;
    /** #rrggbb — the override if set, else derived from the slug (server decides). */
    color: string;
    openTasks: number | null;
    lastSeenAt: string;
  }

  /** onrename: effective name after the ACTIVE project is renamed.
      oncolor: the active project's colour (override or derived), null when
      unknown — drives the wordmark/favicon tint (bronze default). */
  let {
    onrename,
    oncolor,
  }: { onrename?: (name: string) => void; oncolor?: (color: string | null) => void } = $props();

  const activeSlug = apiBase.slice("/p/".length);

  // Same platform test as CheatSheet — "Mod" renders as ⌘ on Apple hardware.
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  /** null until the hub list loads; stays null (no sidebar) if it fails. */
  let projects = $state<HubProject[] | null>(null);

  /** Also the resync path after a failed reorder — quiet on failure, so the
      list keeps whatever it was showing. */
  async function loadProjects(): Promise<void> {
    try {
      // Hub-global endpoint — deliberately NOT prefixed with apiBase.
      const response = await fetch("/api/projects");
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "projects" in body && Array.isArray(body.projects)) {
        projects = body.projects as HubProject[];
      }
    } catch {
      // Quiet failure, same as the mutations below.
    }
  }
  void loadProjects();

  /** Non-destructive: deregisters the project; it re-registers on next CLI use. */
  async function removeProject(slug: string): Promise<void> {
    try {
      const response = await fetch(`/api/projects/${slug}`, { method: "DELETE" });
      if (!response.ok || projects === null) return;
      projects = projects.filter((project) => project.slug !== slug);
      if (slug === activeSlug) location.href = "/";
    } catch {
      // Failures leave the entry in place, same as the list fetch.
    }
  }

  /** Slug of the row being renamed inline; null when none. */
  let editingSlug = $state<string | null>(null);
  let draft = $state("");

  function startRename(project: HubProject): void {
    editingSlug = project.slug;
    draft = project.name;
  }

  const focusAndSelect: Attachment<HTMLInputElement> = (input) => {
    input.focus();
    input.select();
  };

  /** The row whose theme colours the sidebar; null if it left the registry. */
  const activeProject = $derived(projects?.find((project) => project.slug === activeSlug) ?? null);

  // Report the active colour up (bronze default until the list loads, and if
  // the active project leaves the registry). Re-fires when a swatch pick
  // changes it, so the wordmark and favicon recolour live.
  $effect(() => {
    oncolor?.(activeProject?.color ?? null);
  });

  /** Slug of the row whose colour popover is open; null when none. */
  let colorSlug = $state<string | null>(null);

  /** Sends "" to clear back to the derived colour; the row (and the sidebar
      tint, if active) updates from the response's effective value. */
  async function setColor(slug: string, color: string | null): Promise<void> {
    colorSlug = null;
    if (projects === null) return;
    const project = projects.find((entry) => entry.slug === slug);
    if (project === undefined) return;
    try {
      const response = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color: color ?? "" }),
      });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "color" in body && typeof body.color === "string") {
        project.color = body.color;
      }
    } catch {
      // Quiet failure: the old colour stays, same as the other mutations.
    }
  }

  // Any press outside the popover (another row's swatch included — its own
  // click then moves the popover there) closes it.
  function onWindowPointerDown(event: PointerEvent): void {
    if (!(event.target instanceof Element) || event.target.closest(".popover, .swatch") === null) {
      colorSlug = null;
    }
  }

  /** Slug of the row being dragged; null when no drag is in flight. */
  let dragSlug = $state<string | null>(null);
  /** Row the drop line sits on, and which edge; null when not over a row. */
  let dropTarget = $state<{ slug: string; after: boolean } | null>(null);

  // The li is the drag source (the anchor opts out with draggable="false",
  // clicks are unaffected), so the payload is the slug — not a link drag
  // that browsers would treat as a URL drop.
  function onDragStart(event: DragEvent, project: HubProject): void {
    if (event.dataTransfer === null) return;
    event.dataTransfer.setData("text/plain", project.slug);
    event.dataTransfer.effectAllowed = "move";
    dragSlug = project.slug;
    colorSlug = null; // a drag and an open popover don't mix
  }

  /** Before/after the target row, split at its vertical midpoint. */
  function isBelowMidpoint(event: DragEvent & { currentTarget: HTMLElement }): boolean {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2;
  }

  function onRowDragOver(event: DragEvent & { currentTarget: HTMLElement }, slug: string): void {
    if (dragSlug === null) return; // foreign drags (text, files) fall through
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    // No line over the dragged row itself — dropping there is a no-op.
    dropTarget = slug === dragSlug ? null : { slug, after: isBelowMidpoint(event) };
  }

  // Rows touch, so leaving one row usually enters the next; only a pointer
  // leaving the list altogether clears the line.
  function onListDragLeave(event: DragEvent & { currentTarget: HTMLElement }): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    dropTarget = null;
  }

  function onRowDrop(event: DragEvent & { currentTarget: HTMLElement }, targetSlug: string): void {
    const slug = dragSlug;
    if (slug === null || projects === null) return;
    event.preventDefault();
    const from = projects.findIndex((entry) => entry.slug === slug);
    const targetIndex = projects.findIndex((entry) => entry.slug === targetSlug);
    if (from === -1 || targetIndex === -1) return;
    // Insertion point in the current list, minus one when the dragged row
    // sits above it (its removal shifts the rest up) — i.e. the final
    // 0-based index, which is what the server's remove-then-insert takes.
    let to = isBelowMidpoint(event) ? targetIndex + 1 : targetIndex;
    if (from < to) to -= 1;
    if (to === from) return;
    projects.splice(to, 0, ...projects.splice(from, 1));
    void moveProject(slug, to);
  }

  /** Fires on the source row after drops and cancelled drags (Escape) alike. */
  function onDragEnd(): void {
    dragSlug = null;
    dropTarget = null;
  }

  /** Optimistic: the list is already reordered; failure re-syncs from the
      server instead of guessing how to undo. */
  async function moveProject(slug: string, index: number): Promise<void> {
    try {
      const response = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index }),
      });
      if (!response.ok) void loadProjects();
    } catch {
      void loadProjects();
    }
  }

  /** Below the CSS breakpoint the sidebar collapses behind a fixed toggle. */
  let drawerOpen = $state(false);
  // Mirrors the CSS breakpoint below, so a stale open drawer after resizing
  // wide again doesn't swallow Escape.
  const narrow = window.matchMedia("(max-width: 999.98px)");

  // Capture phase, so this wins over App's window listener when it stops
  // propagation (Escape is a global "clear filter" key there), and so
  // Mod+Shift+1…9 works even mid-edit. A rename in progress gets Escape
  // first: its own handler cancels it and stops there. Then innermost-out:
  // colour popover before the drawer.
  function onWindowKeydown(event: KeyboardEvent): void {
    // Mod+Shift+digit opens the nth project. Matched by event.code, not
    // event.key: Shift turns digit keys into punctuation (e.g. "!") on most
    // layouts. Digits without a project fall through untouched.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) {
      const digit = /^Digit([1-9])$/.exec(event.code);
      const project = digit === null ? undefined : projects?.[Number(digit[1]) - 1];
      if (project !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        if (project.slug !== activeSlug) location.href = `/p/${project.slug}`;
        return;
      }
    }
    if (event.key !== "Escape" || editingSlug !== null) return;
    if (colorSlug !== null) {
      event.stopPropagation();
      colorSlug = null;
      return;
    }
    if (!drawerOpen || !narrow.matches) return;
    event.stopPropagation();
    drawerOpen = false;
  }

  function onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitRename();
    } else if (event.key === "Escape") {
      event.stopPropagation(); // Escape is a global "clear filter" key.
      editingSlug = null;
    }
  }

  /** Sends the raw draft; the server trims, and blank clears the override. */
  async function commitRename(): Promise<void> {
    const slug = editingSlug;
    editingSlug = null; // also guards the blur that follows Enter
    if (slug === null || projects === null) return;
    const project = projects.find((entry) => entry.slug === slug);
    if (project === undefined || draft === project.name) return;
    try {
      const response = await fetch(`/api/projects/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft }),
      });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "name" in body && typeof body.name === "string") {
        project.name = body.name;
        if (slug === activeSlug) onrename?.(body.name);
      }
    } catch {
      // Quiet failure: the old name stays, same as removeProject.
    }
  }
</script>

<svelte:window
  onkeydowncapture={onWindowKeydown}
  onpointerdown={colorSlug !== null ? onWindowPointerDown : undefined}
/>

{#if projects !== null}
  <button
    class="toggle"
    aria-expanded={drawerOpen}
    aria-label={drawerOpen ? "Hide projects" : "Show projects"}
    title={drawerOpen ? "Hide projects" : "Show projects"}
    onclick={() => (drawerOpen = !drawerOpen)}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  </button>
  {#if drawerOpen}
    <div class="backdrop" aria-hidden="true" onclick={() => (drawerOpen = false)}></div>
  {/if}
  <nav class="sidebar" class:open={drawerOpen} aria-label="Projects" style:--project-color={activeProject?.color}>
    <span class="brand"><Wordmark size={13} /></span>
    <!-- Presentational: with the numbered swatches below it spells Mod+Shift+N. -->
    <span class="hint" aria-hidden="true">
      <kbd>{isMac ? "⌘" : "Ctrl"}</kbd><span class="plus">+</span><kbd>Shift</kbd><span class="plus">+</span>
    </span>
    <ul ondragleave={onListDragLeave}>
      {#each projects as project, index (project.slug)}
        <li
          draggable={editingSlug !== project.slug}
          class:dragging={dragSlug === project.slug}
          class:drop-before={dropTarget !== null && dropTarget.slug === project.slug && !dropTarget.after}
          class:drop-after={dropTarget !== null && dropTarget.slug === project.slug && dropTarget.after}
          ondragstart={(event) => onDragStart(event, project)}
          ondragover={(event) => onRowDragOver(event, project.slug)}
          ondrop={(event) => onRowDrop(event, project.slug)}
          ondragend={onDragEnd}
        >
          {#if editingSlug === project.slug}
            <input
              class="rename"
              type="text"
              bind:value={draft}
              aria-label={`New name for ${project.name}`}
              onkeydown={onRenameKeydown}
              onblur={() => void commitRename()}
              {@attach focusAndSelect}
            />
          {:else}
            <button
              class="swatch"
              class:numbered={index < 9}
              style:--swatch-color={project.color}
              aria-haspopup="dialog"
              aria-expanded={colorSlug === project.slug}
              aria-label={`Change colour of ${project.name}`}
              title="Change colour"
              onclick={() => (colorSlug = colorSlug === project.slug ? null : project.slug)}
            >{#if index < 9}<span aria-hidden="true">{index + 1}</span>{/if}</button>
            <a
              href={`/p/${project.slug}`}
              draggable="false"
              class:active={project.slug === activeSlug}
              aria-current={project.slug === activeSlug ? "page" : undefined}
              title={project.path}
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
              onclick={() => startRename(project)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            <button
              class="remove"
              aria-label={`Remove ${project.name} from sidebar`}
              title="Remove from sidebar (project data is untouched)"
              onclick={() => removeProject(project.slug)}
            >×</button>
            {#if colorSlug === project.slug}
              <ColorPopover color={project.color} onpick={(picked) => void setColor(project.slug, picked)} />
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  </nav>
{/if}

<style>
  .sidebar {
    position: sticky;
    top: 0;
    flex: 0 0 230px;
    height: 100vh;
    overflow-y: auto;
    padding: 28px 12px 16px;
    border-right: 1px solid var(--guide);
    user-select: none;
    /* Faint wash of the active project's colour (--project-color, set on the
       nav) so each kalamu is tellable at a glance. */
    background: color-mix(in srgb, var(--project-color, transparent) 5%, transparent);
  }

  /* The header wordmark, repeated for the hub. */
  .brand {
    display: flex;
    align-items: center;
    padding: 0 10px;
    margin-bottom: 4px;
  }
  /* Echo of the active project's colour beside the brand. */
  .brand::after {
    content: "";
    width: 7px;
    height: 7px;
    margin-left: 7px;
    border-radius: 50%;
    background: var(--project-color, transparent);
  }

  /* Quiet shortcut hint; CheatSheet's kbd look, muted. The numbered
     swatches below supply the n. */
  .hint {
    display: block;
    padding: 0 10px;
    margin-bottom: 12px;
    font-size: 11px;
    color: var(--muted);
  }
  .hint kbd {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid var(--guide);
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--muted);
  }
  .hint .plus {
    margin: 0 2px;
  }

  ul {
    list-style: none;
  }

  /* Hover target for the row: anchor and remove button are siblings. */
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
  /* li:hover (not a:hover) so the row stays lit while pointing at the ×. */
  li:hover a {
    background: var(--guide);
    color: var(--fg);
  }
  /* Active row in the project's colour — the tag-chip pattern (colour text
     over a 15% tint), so it stays legible in both themes. */
  a.active,
  li:hover a.active {
    background: color-mix(in srgb, var(--project-color, var(--fg)) 15%, transparent);
    color: var(--project-color, var(--fg));
    font-weight: 500;
  }
  li:hover a.active {
    background: color-mix(in srgb, var(--project-color, var(--fg)) 22%, transparent);
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
  /* First nine rows: a kbd-like square whose digit is the Mod+Shift+N
     shortcut — colour text over a tint (the tag-chip pattern), so the
     project colour stays tellable in both themes. Rows 10+ keep the dot. */
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
    color: var(--muted);
    background: var(--guide);
  }
  /* The hover buttons replace the count while they're showing. */
  li:hover .count,
  li:has(.edit:focus-visible) .count,
  li:has(.remove:focus-visible) .count {
    visibility: hidden;
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
    opacity: 0;
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
  li:hover .edit,
  li:hover .remove,
  .edit:focus-visible,
  .remove:focus-visible {
    opacity: 1;
  }
  .edit:hover,
  .remove:hover {
    color: var(--fg);
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

  .toggle,
  .backdrop {
    display: none;
  }

  /* Below the breakpoint the column collapses behind the toggle and the
     sidebar becomes a fixed drawer — above the help button (z 15), below
     the toast (20) and overlays (30). */
  @media (max-width: 999.98px) {
    .toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      position: fixed;
      top: 26px;
      left: 12px;
      z-index: 18;
      padding: 4px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--muted);
      cursor: pointer;
    }
    .toggle:hover {
      color: var(--fg);
    }

    .sidebar {
      display: none;
    }
    .sidebar.open {
      display: block;
      position: fixed;
      left: 0;
      z-index: 17;
      width: 230px;
      /* Same wash as the column, mixed into the panel so it stays opaque. */
      background: color-mix(in srgb, var(--project-color, transparent) 5%, var(--panel));
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
    }
    /* The toggle stays fixed over the drawer's top-left corner. */
    .sidebar.open .brand {
      padding-left: 34px;
    }

    .backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 16;
      background: rgba(0, 0, 0, 0.3);
    }
  }
</style>
