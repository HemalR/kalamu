<script lang="ts">
  import { tagColor } from "@kalamu/core";
  import CheatSheet from "./components/CheatSheet.svelte";
  import CliSheet from "./components/CliSheet.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import HubHint from "./components/HubHint.svelte";
  import OutlineNode from "./components/OutlineNode.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toast from "./components/Toast.svelte";
  import UpdateChip from "./components/UpdateChip.svelte";
  import Wordmark from "./components/Wordmark.svelte";
  import { api, apiBase, type ProjectInfo } from "./lib/api";
  import { OutlineStore } from "./lib/outline.svelte";
  import { matches, SHORTCUTS as S } from "./lib/shortcuts";
  import { theme } from "./lib/theme.svelte";

  const store = new OutlineStore();
  void store.init();

  /** Project this instance serves (name for the title, platform/hubInstalled
      for HubHint); null until (and unless) it loads. */
  let project = $state<ProjectInfo | null>(null);
  void api
    .getProject()
    .then((info) => {
      project = info;
      document.title = `Kalamu | ${info.name}`;
    })
    .catch(() => {});

  /** At most one overlay at a time; Overlay.svelte owns Escape while one is open. */
  let overlay = $state<"palette" | "help" | "cli" | null>(null);

  const visibleRoots = $derived(store.visibleChildren(null));

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // The palette owns the keyboard while open: it stops propagation of the
    // keys it handles, and Overlay intercepts Escape at the capture phase
    // (sublevels step back, so Escape must never be interpreted here too).
    if (overlay === "palette") return;
    // Mod+/ toggles the cheat sheet from anywhere, including while editing.
    if (matches(event, S.help)) {
      event.preventDefault();
      overlay = overlay === "help" ? null : "help";
      return;
    }
    // Mod+K opens the palette from anywhere too — it acts on the last-focused node.
    if (matches(event, S.palette)) {
      event.preventDefault();
      overlay = "palette";
      return;
    }
    if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
    // From here on: no node is being edited.
    if (event.key === "Escape" && store.filterTag !== null) {
      store.setFilter(null);
      return;
    }
    if (event.key === "?" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      overlay = "help";
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
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#snippet app()}
<main>
  <header>
    <span class="brandline"><Wordmark />{#if project !== null}<span class="project">| {project.name}</span>{/if}</span>
    <div class="actions">
      <button class="clean-up" title="Delete completed tasks and their subtrees" onclick={() => store.clean()}>
        Clean up
      </button>
      <button
        class="theme-toggle"
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
    </div>
  </header>

  {#if !store.connected}
    <div class="offline" role="alert">
      Kalamu server unreachable — editing is paused so you don't lose work. Waiting to reconnect…
    </div>
  {/if}

  {#if store.loadError !== null}
    <p class="notice">Couldn't load the outline: {store.loadError}</p>
  {:else if !store.loaded}
    <p class="notice">Loading…</p>
  {:else}
    {#if store.filterTag !== null}
      <div class="filter-bar">
        <button
          class="filter-pill"
          style:--tag-color={tagColor(store.filterTag, store.meta.tags)}
          title="Clear filter (Esc)"
          onclick={() => store.setFilter(null)}
        >
          #{store.filterTag} <span class="x" aria-hidden="true">×</span>
        </button>
      </div>
    {/if}
    <div class="outline">
      {#each visibleRoots as node (node.id)}
        <OutlineNode {node} {store} />
      {/each}
    </div>
    <button class="tail" onclick={() => store.focusTail()} aria-label="Continue the outline">
      {#if visibleRoots.length === 0 && store.filterTag === null}
        <span>Click here (or press Enter) to start your outline</span>
      {/if}
    </button>
  {/if}
</main>

<!-- In flow after <main>, so under the hub they stay inside the content column. -->
<HubHint {store} {project} />
<UpdateChip {store} {project} />

<button class="help-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onclick={() => (overlay = "help")}>?</button>

{#if overlay === "help"}
  <CheatSheet onclose={() => (overlay = null)} />
{:else if overlay === "cli"}
  <CliSheet onclose={() => (overlay = null)} />
{:else if overlay === "palette"}
  <CommandPalette
    {store}
    onclose={() => (overlay = null)}
    onshowshortcuts={() => (overlay = "help")}
    onshowcli={() => (overlay = "cli")}
  />
{/if}

<Toast message={store.toast} />
{/snippet}

{#if apiBase !== ""}
  <!-- Hub mode: project sidebar beside the regular app. -->
  <div class="hub">
    <Sidebar
      onrename={(name) => {
        if (project !== null) project.name = name;
        document.title = `Kalamu | ${name}`;
      }}
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
     the top-left; keep the wordmark clear of it at narrow widths. */
  @media (max-width: 999.98px) {
    .hub main {
      padding-left: 56px;
    }
  }

  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 32px 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
    margin-bottom: 20px;
  }

  .brandline {
    display: flex;
    align-items: center;
  }

  /* Project name stays in the wordmark's muted tone, just less bold. */
  .brandline .project {
    margin-left: 0.5em;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.02em;
    color: var(--muted);
  }

  /* Right-aligned header actions; more buttons will land here later. */
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Quiet ghost buttons, matching the wordmark's tone. */
  .actions > button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .actions > button:hover {
    color: var(--fg);
  }

  button.clean-up {
    font: inherit;
    font-size: 12px;
    line-height: 1;
    padding: 4px 7px;
  }

  .notice {
    color: var(--muted);
    font-size: 14px;
  }

  /* Amber warning tones, local to the banner (app.css has no warn token). */
  .offline {
    margin-bottom: 16px;
    padding: 8px 12px;
    border: 1px solid light-dark(rgba(154, 103, 0, 0.35), rgba(227, 179, 65, 0.35));
    border-radius: 6px;
    background: light-dark(#fff8e5, rgba(227, 179, 65, 0.12));
    color: light-dark(#9a6700, #e3b341);
    font-size: 13px;
  }

  .outline {
    padding-left: 18px; /* gutter for chevrons */
  }

  .filter-bar {
    margin: -6px 0 12px;
  }

  .filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1;
    padding: 5px 10px;
    border-radius: 999px;
    color: var(--tag-color);
    background: color-mix(in srgb, var(--tag-color) 15%, transparent);
  }
  .filter-pill:hover {
    background: color-mix(in srgb, var(--tag-color) 24%, transparent);
  }
  .filter-pill .x {
    font-size: 14px;
    opacity: 0.7;
  }

  .tail {
    flex: 1;
    min-height: 30vh;
    display: block;
    width: 100%;
    padding: 8px 0 0 36px;
    border: none;
    background: none;
    cursor: text;
    text-align: left;
    font: inherit;
    color: var(--muted);
  }

  .help-button {
    position: fixed;
    right: 18px;
    bottom: 18px;
    z-index: 15;
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
</style>
