<script lang="ts">
  import { tagColor } from "@kalamu/core";
  import CheatSheet from "./components/CheatSheet.svelte";
  import CliSheet from "./components/CliSheet.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import OutlineNode from "./components/OutlineNode.svelte";
  import Toast from "./components/Toast.svelte";
  import { OutlineStore } from "./lib/outline.svelte";
  import { matches, SHORTCUTS as S } from "./lib/shortcuts";

  const store = new OutlineStore();
  void store.init();

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

<main>
  <header>kalamu</header>

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

<style>
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 32px 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--muted);
    user-select: none;
    margin-bottom: 20px;
  }

  .notice {
    color: var(--muted);
    font-size: 14px;
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
