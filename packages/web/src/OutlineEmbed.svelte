<script module lang="ts">
  import type { KalamuNode } from "@kalamu/core";

  /** Demo content (ported from the landing page's old hand-rolled demo). */
  const T0 = "2026-07-01T09:00:00.000Z";
  const seedNode = (
    id: string,
    parentId: string | null,
    kind: KalamuNode["kind"],
    text: string,
    extra: Partial<Pick<KalamuNode, "doneAt" | "priority" | "assignee">> = {},
  ): KalamuNode => ({ id, parentId, kind, text, createdAt: T0, doneAt: null, handoff: null, ...extra });

  const DEMO_SEED: KalamuNode[] = [
    seedNode("demo_hero", null, "task", "Ship the landing page hero #marketing", { priority: 2 }),
    seedNode("demo_wire", "demo_hero", "task", "Wire up the interactive outline demo #svelte", { doneAt: T0 }),
    seedNode("demo_copy", "demo_hero", "task", "Write the section 2 copy", { assignee: "human" }),
    seedNode("demo_ci", null, "task", "Fix flaky CI test #bug", { priority: 1, assignee: "agent" }),
    seedNode("demo_naming", null, "discussion", "Naming for the v0.7 release"),
    seedNode("demo_names", "demo_naming", "bullet", "kalamu vs kalam vs outlinr #naming"),
    seedNode("demo_coffee", null, "task", "Buy coffee", { doneAt: T0, priority: 5 }),
  ];
</script>

<script lang="ts">
  import { tagColor } from "@kalamu/core";
  import CommandPalette from "./components/CommandPalette.svelte";
  import OutlineNode from "./components/OutlineNode.svelte";
  import Toast from "./components/Toast.svelte";
  import { setBackend } from "./lib/api";
  import { createMemoryBackend } from "./lib/memory-backend";
  import { OutlineStore } from "./lib/outline.svelte";
  import { matches, SHORTCUTS as S } from "./lib/shortcuts";

  interface Props {
    seed?: KalamuNode[];
  }

  let { seed = DEMO_SEED }: Props = $props();

  // The REAL app against an in-memory backend: same store, same node
  // component, same keyboard model — behavior-identical to the product.
  // The seed is deliberately read once, at instantiation: the demo's whole
  // life is one page load, so a later `seed` change is meaningless.
  // svelte-ignore state_referenced_locally
  setBackend(createMemoryBackend(seed));
  const store = new OutlineStore();
  void store.init();

  let paletteOpen = $state(false);

  const visibleRoots = $derived(store.visibleChildren(null));

  /** The demo lives in the palette + CLI, not on this page. */
  function sheetUnavailable(): void {
    paletteOpen = false;
    store.showToast("Not part of this demo — install kalamu to see the full app.");
  }

  // App.svelte's window handler, scoped to the embed: it only fires while
  // focus is inside (contenteditable keydowns bubble up here), so the
  // marketing page around it never loses its own shortcuts.
  function onKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // The palette owns the keyboard while open (it stops propagation of the
    // keys it handles, and Overlay intercepts Escape at the capture phase).
    if (paletteOpen) return;
    // Mod+K opens the palette from anywhere in the embed, including while editing.
    if (matches(event, S.palette)) {
      event.preventDefault();
      paletteOpen = true;
      return;
    }
    if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
    // From here on: no node is being edited.
    if (event.key === "Escape" && store.filterTag !== null) {
      store.setFilter(null);
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

<!-- Keyboard wrapper, not a widget: keydowns from the focusable rows inside bubble up here. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="embed" onkeydown={onKeydown}>
  <div class="window-bar" aria-hidden="true">
    <span class="dot-control"></span>
    <span class="dot-control"></span>
    <span class="dot-control"></span>
    <span class="window-title">demo.outline — click a line, try Enter / Tab</span>
  </div>

  <div class="body">
    {#if store.loadError !== null}
      <p class="notice">Couldn't load the demo: {store.loadError}</p>
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
  </div>
</div>

{#if paletteOpen}
  <CommandPalette
    {store}
    onclose={() => (paletteOpen = false)}
    onshowshortcuts={sheetUnavailable}
    onshowcli={sheetUnavailable}
  />
{/if}

<Toast message={store.toast} />

<style>
  /* Outer card treatment carried over from the old hand-rolled demo. */
  .embed {
    position: relative;
    width: 100%;
    max-width: 440px;
    min-height: 320px;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    border: 1px solid var(--guide);
    background: var(--panel);
    box-shadow: 0 24px 48px -28px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    /* Match the app's body font exactly (app.css); the host page's differs. */
    font:
      15px/1.5 -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      Roboto,
      "Helvetica Neue",
      sans-serif;
    color: var(--fg);
  }

  /* app.css's global monospace-outline rule, carried by the embed. */
  .embed :global(.node .text) {
    font-family: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 13.5px;
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

  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px 14px;
  }

  .notice {
    color: var(--muted);
    font-size: 14px;
  }

  /* Filter pill, outline gutter, and tail: same recipes as App.svelte. */
  .filter-bar {
    margin: -2px 0 8px;
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

  .outline {
    padding-left: 18px; /* gutter for chevrons */
  }

  .tail {
    flex: 1;
    min-height: 40px; /* App uses 30vh; a card wants a modest landing strip */
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
</style>
