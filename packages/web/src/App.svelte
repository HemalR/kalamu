<script lang="ts">
  import CheatSheet from "./components/CheatSheet.svelte";
  import CliSheet from "./components/CliSheet.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import FilterMenu from "./components/FilterMenu.svelte";
  import Find from "./components/Find.svelte";
  import HubHint from "./components/HubHint.svelte";
  import OutlineBody from "./components/OutlineBody.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toast from "./components/Toast.svelte";
  import UpdateChip from "./components/UpdateChip.svelte";
  import Wordmark from "./components/Wordmark.svelte";
  import { api, apiBase, type ProjectInfo } from "./lib/api";
  import { BRAND_BRONZE, setFavicon } from "./lib/favicon";
  import { fileRefs } from "./lib/file-refs.svelte";
  import { handleGlobalKeys } from "./lib/global-keys";
  import { consumeLaunches, planLaunch } from "./lib/launch";
  import { OutlineStore } from "./lib/outline.svelte";
  import { theme } from "./lib/theme.svelte";
  import { formatZoomHash, parseZoomHash } from "./lib/zoom";

  /** Project this instance serves (name for the title, platform/hubInstalled
      for HubHint, branchDrift for the banner); null until (and unless) it
      loads. Reloaded whenever the server reports a project change. */
  let project = $state<ProjectInfo | null>(null);
  /** Only the latest request may land: a branch checkout can fire several in a row. */
  let projectRequest = 0;
  function loadProject(): void {
    const request = ++projectRequest;
    void api
      .getProject()
      .then((info) => {
        if (request !== projectRequest) return;
        project = info;
        fileRefs.configure(info); // file chips need repoRoot/editorTemplate on first render
        document.title = `Kalamu | ${info.name}`;
      })
      .catch(() => {});
  }

  /**
   * The zoom's only persistence is the URL hash, in server ids so links
   * survive reloads. Assigning location.hash pushes a history entry — Back
   * then unwinds zoom levels; an already-current hash (Back itself, or a
   * hashchange echo) writes nothing, so no loop and no duplicate entry.
   */
  function writeZoomHash(serverId: string | null): void {
    const hash = formatZoomHash(serverId);
    if (hash === "") {
      // hash = "" would leave a dangling "#"; pushState keeps Back unwinding.
      if (location.hash !== "") history.pushState(null, "", location.pathname + location.search);
    } else if (location.hash !== hash) {
      location.hash = hash;
    }
  }

  // A branch checkout on the server side reports a project change (SSE); refetch so branchDrift is current.
  const store = new OutlineStore({ onZoom: writeZoomHash, onProjectChanged: loadProject });
  loadProject();
  void store.init().then(() => {
    // A #z=<id> hash restores zoom across reloads; garbage or a since-deleted
    // id is dropped without polluting history.
    if (!store.loaded || location.hash === "") return;
    const id = parseZoomHash(location.hash);
    const local = id === null ? null : store.localId(id);
    if (local !== null && store.tree.byId.has(local)) store.setZoom(local);
    else history.replaceState(null, "", location.pathname + location.search);
  });

  /** Back/forward (and hand-edited hashes): mirror the hash into the store.
      An already-applied hash is a no-op, so setZoom's own write can't loop. */
  function onHashChange(): void {
    if (!store.loaded) return;
    const id = parseZoomHash(location.hash);
    const local = id === null ? null : store.localId(id);
    if (local === store.zoomId) return;
    if (local === null || store.tree.byId.has(local)) store.setZoom(local);
  }

  // Installed-app deep links land here instead of in a new tab (lib/launch.ts).
  consumeLaunches((target) => {
    const step = planLaunch(target, new URL(location.href));
    if (step.kind === "navigate") location.href = step.href;
    else if (step.kind === "zoom") {
      // Empty hash = zoom out; otherwise assigning the hash fires hashchange -> onHashChange applies it.
      if (step.hash === "") store.setZoom(null);
      else location.hash = step.hash;
    }
  });

  /** The stuck header's measured height, so the sticky breadcrumbs stack right
      beneath it however the header wraps or grows (Breadcrumbs.svelte). */
  let headerHeight = $state(0);

  const paletteHint = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";

  /** At most one overlay at a time; Overlay.svelte owns Escape while one is open. */
  let overlay = $state<"palette" | "help" | "cli" | "find" | null>(null);

  /** Active project's colour (hub only), bound from the Sidebar; null falls
      back to the bronze brand. Tints the wordmark and the favicon. */
  let markColor = $state<string | null>(null);
  $effect(() => {
    setFavicon(markColor ?? BRAND_BRONZE);
    // Browser UI / installed-app title bar follows the project colour too.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", markColor ?? BRAND_BRONZE);
  });

  function onWindowKeydown(event: KeyboardEvent): void {
    // The palette and Find own the keyboard while open: they stop propagation
    // of the keys they handle, and Overlay intercepts Escape at the capture
    // phase (sublevels step back, so Escape must never be interpreted here too).
    if (overlay === "palette" || overlay === "find") return;
    handleGlobalKeys(event, store, {
      palette: () => (overlay = "palette"),
      help: (toggle) => (overlay = toggle && overlay === "help" ? null : "help"),
      find: () => (overlay = "find"),
    });
  }
</script>

<svelte:window
  onkeydown={onWindowKeydown}
  onhashchange={onHashChange}
  onpagehide={() => store.pauseEvents()}
  onpageshow={() => store.resumeEvents()}
/>

{#snippet app()}
<main style:--header-height="{headerHeight}px">
  <header bind:clientHeight={headerHeight}>
    <span class="brandline">
      <span class="brand"><Wordmark />{#if project !== null}<span class="sep" aria-hidden="true">|</span>{/if}</span>
      {#if project !== null}<span class="project" title={project.name}>{project.name}</span>{/if}
    </span>
    <div class="actions">
      <button
        class="ghost-button"
        aria-label="Find"
        title="Find — search text or jump to a node id"
        onclick={() => (overlay = "find")}
      >
        <!-- lucide search -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>
      <FilterMenu {store} />
      <!-- A word on wide screens, an icon on phones (the header must stay one line). -->
      <button
        class="ghost-button clean-up"
        aria-label="Clean up"
        title="Clean up — delete completed tasks and their subtrees (undoable)"
        onclick={() => store.clean()}
      >
        <!-- lucide eraser -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </svg>
        <span class="word" aria-hidden="true">Clean up</span>
      </button>
      <!-- Overview mode: rows show a short derived label instead of their full
           text. Purely a view toggle, so aria-pressed carries the state and the
           accessible name stays put; the icon and tooltip say what a click does. -->
      <button
        class={["ghost-button", "overview-toggle", { on: store.overview }]}
        aria-label="Overview mode"
        aria-pressed={store.overview}
        title={store.overview ? "Show the full text of every item" : "Overview mode — show short labels"}
        onclick={() => store.toggleOverview()}
      >
        <!-- fold-vertical / unfold-vertical: same dashed midline, the two
             chevrons flip to point at it (fold) or away from it (unfold). -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 22v-6m0-8V2M4 12H2m8 0H8m8 0h-2m8 0h-2" />
          <path d={store.overview ? "m15 19-3 3-3-3m6-14-3-3-3 3" : "m15 19-3-3-3 3m6-14-3 3-3-3"} />
        </svg>
      </button>
      <button
        class="ghost-button"
        aria-label={theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onclick={() => theme.toggle()}
      >
        {#if theme.mode === "dark"}
          <!-- sun -->
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        {:else}
          <!-- moon -->
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        {/if}
      </button>
      <!-- The palette is the whole command set; on a touch screen this button
           is the only way in, since there is no ⌘K to press. -->
      <button
        class="ghost-button"
        aria-label="Command palette"
        title="Command palette ({paletteHint})"
        onclick={() => (overlay = "palette")}
      >
        <!-- lucide command -->
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
        </svg>
      </button>
    </div>
  </header>

  {#if store.outlineError !== null}
    <div class="warning" role="alert">
      The outline file can't be read, so this view may be out of date and changes won't save: {store.outlineError}
    </div>
  {/if}

  {#if !store.connected}
    <div class="warning" role="alert">
      Kalamu server unreachable — editing is paused so you don't lose work. Waiting to reconnect…
    </div>
  {/if}

  <!-- The CLI's stderr off-default-branch warning (SPEC key decision 20), surfaced in the UI. -->
  {#if project?.branchDrift}
    <div class="warning" role="alert">
      This checkout is on <code>{project.branchDrift.head}</code>, not <code>{project.branchDrift.expected}</code>, so
      the outline shown here is that branch's copy. Check out <code>{project.branchDrift.expected}</code> and use a
      worktree for other branches.
    </div>
  {/if}

  <OutlineBody {store} rootLabel={project?.name ?? "Home"} />
</main>

<!-- In flow after <main>, so under the hub they stay inside the content column. -->
<HubHint {store} {project} />
<UpdateChip {store} {project} />

<!-- Keyboard help; hidden on touch screens (see the style), where it covered
     text and opened a sheet of keys nobody there can press. -->
<button class="help-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onclick={() => (overlay = "help")}>?</button>

{#if overlay === "help"}
  <CheatSheet onclose={() => (overlay = null)} />
{:else if overlay === "cli"}
  <CliSheet onclose={() => (overlay = null)} />
{:else if overlay === "find"}
  <Find {store} onclose={() => (overlay = null)} />
{:else if overlay === "palette"}
  <CommandPalette
    {store}
    onclose={() => (overlay = null)}
    onshowshortcuts={() => (overlay = "help")}
    onshowcli={() => (overlay = "cli")}
    onshowfind={() => (overlay = "find")}
  />
{/if}

<Toast toast={store.toast} ondismiss={() => store.dismissToast()} />
{/snippet}

{#if apiBase !== ""}
  <!-- Hub mode: project sidebar beside the regular app. -->
  <div class="hub" style:--mark={markColor ?? undefined}>
    <Sidebar
      onrename={(name) => {
        if (project !== null) project.name = name;
        document.title = `Kalamu | ${name}`;
      }}
      bind:color={markColor}
      refresh={store.outlineChanges}
    />
    <div class="hub-main">{@render app()}</div>
  </div>
{:else}
  {@render app()}
{/if}

<style>
  .hub {
    display: flex;
    align-items: flex-start;
  }

  .hub-main {
    flex: 1;
    min-width: 0;
  }

  /* Below the sidebar breakpoint a fixed toggle (Sidebar.svelte) sits in
     the top-left; keep the wordmark clear of it at narrow widths.
     (Literal breakpoints: see lib/breakpoints.ts.) */
  @media (max-width: 799.98px) {
    .hub main {
      padding-left: 56px;
    }
  }

  main {
    max-width: 760px;
    margin: 0 auto;
    /* Top padding lives on the sticky header. The right side holds the
       rows' copy and delete buttons (see OutlineNode.svelte). */
    padding: 0 var(--row-gutter-right) 0 32px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    /* Sticks while the outline scrolls. main's old 28px top padding and the
       old 20px margin below both live here as padding, so the opaque
       background reaches the viewport edge with no see-through strips.
       Sits above the breadcrumbs so the header's dropdowns cover the trail's
       progress bar, and below every overlay. */
    position: sticky;
    top: 0;
    z-index: var(--z-header);
    background: var(--bg);
    padding: 28px 0 20px;
    /* Out into the rows' right gutter as far as their delete buttons reach
       (OutlineNode.svelte), so the last header action and the row buttons
       share one right edge. */
    margin-right: calc(8px - var(--row-gutter-right));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    user-select: none;
  }

  /* On phones only the header has to clear the toggle; the outline beneath it
     takes the width back (the outline's own chevron gutter still holds the
     chevrons). */
  @media (max-width: 639.98px) {
    main,
    .hub main {
      padding-left: 12px;
    }
    /* One line, whatever the project is called: the gutter's row buttons
       moved into the rows, the name truncates, Clean up is its icon, and the
       hub drops the wordmark (its drawer carries one). */
    header {
      margin-right: 0;
    }
    .hub header {
      padding-left: 44px;
    }
    .hub .brand,
    .clean-up .word {
      display: none;
    }
    /* header-qualified to beat the word-mode rules further down */
    header button.clean-up {
      padding: 4px;
    }
    header .clean-up svg {
      display: block;
    }
  }

  .brandline {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .brand {
    flex: none;
    display: flex;
    align-items: center;
  }

  .sep {
    margin: 0 0.4em;
    font-size: 12px;
    color: var(--muted);
  }

  /* Project name stays in the wordmark's muted tone, just less bold. */
  .brandline .project {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  /* Right-aligned header actions (app.css's .ghost-button). */
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Toggled on: the same soft fill the palette uses for an active row, so the
     button reads as pressed and not merely hovered. */
  button.overview-toggle.on {
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }

  /* The word, until phones swap it for the icon. */
  button.clean-up {
    font: inherit;
    font-size: 12px;
    line-height: 15px;
    padding: 4px 7px;
  }
  .clean-up svg {
    display: none;
  }

  /* Amber notices: the offline and branch-drift banners. */
  .warning {
    margin-bottom: 16px;
    padding: 8px 12px;
    border: 1px solid var(--warn-border);
    border-radius: 6px;
    background: var(--warn-bg);
    color: var(--warn-fg);
    font-size: 13px;
  }

  .warning code {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .help-button {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: var(--z-help);
    width: 28px;
    height: 28px;
    border: 1px solid var(--guide);
    border-radius: 50%;
    background: var(--panel);
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .help-button:hover {
    color: var(--fg);
  }
  @media (hover: none) {
    .help-button {
      display: none;
    }
  }
</style>
