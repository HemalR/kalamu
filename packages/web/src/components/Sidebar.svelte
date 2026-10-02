<script lang="ts">
  /**
   * Hub-mode project list (rendered only when the app is served under
   * /p/<slug>). Entries are plain links on purpose: each project gets a
   * fresh app instance, so navigation is a full page load.
   */
  import { MediaQuery } from "svelte/reactivity";
  import { apiBase } from "../lib/api";
  import { DRAWER_QUERY } from "../lib/breakpoints";
  import { dropIndex, fetchProjects, patchProject, removeProject, type HubProject } from "../lib/hub";
  import { dismissable } from "../lib/popover";
  import ProjectRow from "./ProjectRow.svelte";
  import Wordmark from "./Wordmark.svelte";

  interface Props {
    /** Effective name after the ACTIVE project is renamed. */
    onrename?: (name: string) => void;
    /** The active project's colour (override or derived), null when unknown —
        bound by App to tint the wordmark and favicon (bronze default). */
    color?: string | null;
    /** The store's outline-change counter — each bump means the active
        project's outline landed on disk, so the open-task badges refetch. */
    refresh?: number;
  }

  let { onrename, color = $bindable(null), refresh = 0 }: Props = $props();

  const activeSlug = apiBase.slice("/p/".length);

  // Same platform test as CheatSheet — "Mod" renders as ⌘ on Apple hardware.
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  /** null until the hub list loads; stays null (no sidebar) if it fails. */
  let projects = $state<HubProject[] | null>(null);

  /** The row whose theme colours the sidebar; null if it left the registry. */
  const activeProject = $derived(projects?.find((project) => project.slug === activeSlug) ?? null);

  /** Also the resync path after a failed reorder — quiet on failure, so the
      list keeps whatever it was showing. */
  async function loadProjects(): Promise<void> {
    const list = await fetchProjects();
    if (list === null) return;
    projects = list;
    color = activeProject?.color ?? null;
  }
  void loadProjects();

  // Refetch the badges when the active project's outline changes. Debounced:
  // a burst of SSE events while typing must not refetch per keystroke. The
  // guard reads at fire time (untracked), skipping while a rename or drag is
  // in flight — replacing the list mid-gesture would fight the user.
  $effect(() => {
    if (refresh === 0) return; // mount — the initial loadProjects() above covers it
    const timer = setTimeout(() => {
      if (editingSlug !== null || dragSlug !== null) return;
      void loadProjects();
    }, 300);
    return () => clearTimeout(timer);
  });

  async function remove(slug: string): Promise<void> {
    if (!(await removeProject(slug)) || projects === null) return;
    projects = projects.filter((project) => project.slug !== slug);
    if (slug === activeSlug) location.href = "/";
  }

  /** Slug of the row being renamed inline; null when none. */
  let editingSlug = $state<string | null>(null);

  /** null cancels. Sends the raw draft; the server trims, and blank clears the override. */
  async function rename(project: HubProject, name: string | null): Promise<void> {
    const slug = editingSlug;
    editingSlug = null; // also guards the blur that follows Enter or Escape
    if (slug !== project.slug || name === null || name === project.name) return;
    const saved = await patchProject(slug, { name });
    if (saved === null) return;
    project.name = saved.name;
    if (slug === activeSlug) onrename?.(saved.name);
  }

  /** Sends "" to clear back to the derived colour; the row (and the sidebar
      tint, if active) updates from the response's effective value. */
  async function recolor(project: HubProject, picked: string | null): Promise<void> {
    const saved = await patchProject(project.slug, { color: picked ?? "" });
    if (saved === null) return;
    project.color = saved.color;
    if (project.slug === activeSlug) color = saved.color;
  }

  /** Slug of the row being dragged; null when no drag is in flight. */
  let dragSlug = $state<string | null>(null);
  /** Row the drop line sits on, and which edge; null when not over a row. */
  let dropTarget = $state<{ slug: string; below: boolean } | null>(null);

  function onDragStart(event: DragEvent, project: HubProject): void {
    if (event.dataTransfer === null) return;
    event.dataTransfer.setData("text/plain", project.slug);
    event.dataTransfer.effectAllowed = "move";
    dragSlug = project.slug;
  }

  function onRowDragOver(event: DragEvent, slug: string, below: boolean): void {
    if (dragSlug === null) return; // foreign drags (text, files) fall through
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    // No line over the dragged row itself — dropping there is a no-op.
    dropTarget = slug === dragSlug ? null : { slug, below };
  }

  // Rows touch, so leaving one row usually enters the next; only a pointer
  // leaving the list altogether clears the line.
  function onListDragLeave(event: DragEvent & { currentTarget: HTMLElement }): void {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    dropTarget = null;
  }

  /** Optimistic: the list reorders at once; a failed save re-syncs from the
      server instead of guessing how to undo. */
  function onRowDrop(event: DragEvent, targetSlug: string, below: boolean): void {
    const slug = dragSlug;
    if (slug === null || projects === null) return;
    event.preventDefault();
    const from = projects.findIndex((entry) => entry.slug === slug);
    const target = projects.findIndex((entry) => entry.slug === targetSlug);
    if (from === -1 || target === -1) return;
    const to = dropIndex(from, target, below);
    if (to === from) return;
    projects.splice(to, 0, ...projects.splice(from, 1));
    void patchProject(slug, { index: to }).then((saved) => {
      if (saved === null) void loadProjects();
    });
  }

  /** Fires on the source row after drops and cancelled drags (Escape) alike. */
  function onDragEnd(): void {
    dragSlug = null;
    dropTarget = null;
  }

  /** Below the drawer breakpoint the sidebar collapses behind a fixed toggle. */
  let drawerOpen = $state(false);
  // A stale open drawer after resizing wide again must not swallow Escape.
  const narrow = new MediaQuery(DRAWER_QUERY);
</script>

<!-- onfocus: other projects' outlines may have changed while this tab was
     backgrounded (e.g. an agent working in another repo) — no SSE covers
     those, so returning to the tab resyncs the whole list. -->
<svelte:window onfocus={() => void loadProjects()} />

{#if projects !== null}
  <!-- display: contents — the nav stays a flex item of the hub; this only
       scopes the drawer's dismissal (Escape, or a press outside it). -->
  <div class="drawer" {@attach drawerOpen && narrow.current && dismissable(() => (drawerOpen = false))}>
    <button
      class="ghost-button toggle"
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
    <nav class={["sidebar", { open: drawerOpen }]} aria-label="Projects" style:--project-color={activeProject?.color}>
      <span class="brand"><Wordmark size={13} /></span>
      <!-- Presentational: with the numbered swatches below it spells the
           palette's leader sequence, ⌘K then the row's digit. Keyboard-only,
           so touch screens don't show it. -->
      <span class="hint" aria-hidden="true">
        <kbd>{isMac ? "⌘" : "Ctrl+"}K</kbd> then <kbd>{projects.length > 1 ? `1–${Math.min(projects.length, 9)}` : "1"}</kbd> to switch
      </span>
      <ul ondragleave={onListDragLeave}>
        {#each projects as project, index (project.slug)}
          <ProjectRow
            {project}
            {index}
            active={project.slug === activeSlug}
            renaming={editingSlug === project.slug}
            dragging={dragSlug === project.slug}
            dropEdge={dropTarget?.slug === project.slug ? (dropTarget.below ? "after" : "before") : null}
            onrenamestart={() => (editingSlug = project.slug)}
            onrenameend={(name) => void rename(project, name)}
            oncolor={(picked) => void recolor(project, picked)}
            onremove={() => void remove(project.slug)}
            ondragstart={(event) => onDragStart(event, project)}
            ondragover={(event, below) => onRowDragOver(event, project.slug, below)}
            ondrop={(event, below) => onRowDrop(event, project.slug, below)}
            ondragend={onDragEnd}
          />
        {/each}
      </ul>
    </nav>
  </div>
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

  /* Quiet shortcut hint; CheatSheet's kbd look, muted. */
  .hint {
    display: block;
    padding: 0 10px;
    margin-bottom: 12px;
    font-size: 11px;
    color: var(--muted);
  }
  @media (hover: none) {
    .hint {
      display: none;
    }
    .brand {
      margin-bottom: 12px;
    }
  }
  .hint kbd {
    display: inline-block;
    padding: 1px 5px;
    border: 1px solid var(--guide);
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--muted-strong);
  }

  ul {
    list-style: none;
  }

  .drawer {
    display: contents;
  }

  .toggle,
  .backdrop {
    display: none;
  }

  /* Below the breakpoint the column collapses behind the toggle and the
     sidebar becomes a fixed drawer — above the help button, below the toast
     and overlays. (Literal breakpoint: see lib/breakpoints.ts.) */
  @media (max-width: 799.98px) {
    .toggle {
      display: flex;
      position: fixed;
      top: 26px;
      left: 12px;
      z-index: var(--z-drawer-toggle);
    }

    .sidebar {
      display: none;
    }
    .sidebar.open {
      display: block;
      position: fixed;
      left: 0;
      z-index: var(--z-drawer);
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
      z-index: var(--z-backdrop);
      background: rgba(0, 0, 0, 0.3);
    }
  }
</style>
