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
  ): KalamuNode => ({ id, parentId, kind, text, createdAt: T0, doneAt: null, ...extra });

  const DEMO_SEED: KalamuNode[] = [
    seedNode("demo_hero", null, "task", "Ship the landing page hero #marketing"),
    seedNode("demo_wire", "demo_hero", "task", "Wire up the interactive outline demo #svelte", { doneAt: T0 }),
    seedNode("demo_copy", "demo_hero", "task", "Write the section 2 copy", { assignee: "human" }),
    seedNode("demo_ci", null, "task", "Fix flaky CI test #bug", { priority: 1, assignee: "agent" }),
    seedNode("demo_naming", null, "discussion", "Naming for the v0.7 release"),
    seedNode("demo_names", "demo_naming", "bullet", "kalamu vs kalam vs outlinr #naming"),
    seedNode("demo_coffee", null, "task", "Buy coffee", { doneAt: T0, priority: 3 }),
  ];
</script>

<script lang="ts">
  import CommandPalette from "./components/CommandPalette.svelte";
  import Find from "./components/Find.svelte";
  import OutlineBody from "./components/OutlineBody.svelte";
  import Toast from "./components/Toast.svelte";
  import { setBackend } from "./lib/api";
  import { handleGlobalKeys } from "./lib/global-keys";
  import { createMemoryBackend } from "./lib/memory-backend";
  import { OutlineStore } from "./lib/outline.svelte";
  // The host page has no app.css; the embed carries the tokens it renders with.
  import "./tokens.css";

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
  // No hooks: zoom stays in memory (the breadcrumbs are its way back), never
  // in the host page's URL.
  const store = new OutlineStore();
  void store.init();

  let paletteOpen = $state(false);
  let findOpen = $state(false);

  /** The demo lives in the palette + CLI, not on this page. */
  function sheetUnavailable(): void {
    paletteOpen = false;
    store.showToast("Not part of this demo — install kalamu to see the full app.");
  }

  // App's global keys, scoped to the embed: they only fire while focus is
  // inside (keydowns bubble up here), so the marketing page around it never
  // loses its own shortcuts — Find and the cheat sheet included.
  function onkeydown(event: KeyboardEvent): void {
    // The palette owns the keyboard while open (it stops propagation of the
    // keys it handles, and Overlay intercepts Escape at the capture phase).
    if (paletteOpen || findOpen) return;
    handleGlobalKeys(event, store, { palette: () => (paletteOpen = true) });
  }
</script>

<!-- Keyboard wrapper, not a widget: keydowns from the focusable rows inside bubble up here. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="embed" {onkeydown}>
  <div class="window-bar" aria-hidden="true">
    <span class="dot-control"></span>
    <span class="dot-control"></span>
    <span class="dot-control"></span>
    <span class="window-title">demo.outline — click a line, try Enter / Tab</span>
  </div>

  <div class="body">
    <OutlineBody {store} rootLabel="demo.outline" />
  </div>
</div>

{#if findOpen}
  <Find {store} onclose={() => (findOpen = false)} />
{:else if paletteOpen}
  <CommandPalette
    {store}
    onclose={() => (paletteOpen = false)}
    onshowshortcuts={sheetUnavailable}
    onshowcli={sheetUnavailable}
    onshowfind={() => {
      paletteOpen = false;
      findOpen = true;
    }}
  />
{/if}

<Toast toast={store.toast} ondismiss={() => store.dismissToast()} />

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
    --surface: var(--panel); /* the sticky breadcrumbs' backdrop */
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

  /* The right padding is the rows' copy/delete gutter (OutlineNode.svelte). */
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 12px var(--row-gutter-right) 12px 14px;
    /* A card wants a modest landing strip, not the app's 30vh. */
    --tail-min-height: 40px;
    --filter-bar-margin: -2px 0 8px;
  }
</style>
