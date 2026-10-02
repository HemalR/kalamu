<!--
  The outline itself, shared by the app and the landing-page embed: the load
  state, the active tag filter's pill, the zoom breadcrumbs, the rows, and the
  tail that continues the outline. Rendered as siblings (no wrapper), so the
  tail can take the rest of the host's flex column.

  Hosts tune it with custom properties: --tail-min-height (default 30vh) and
  --filter-bar-margin. Rows hang their chevrons in this component's left
  gutter; the host leaves --row-gutter-right clear for the copy/delete buttons.
-->
<script lang="ts">
  import { tagColor } from "@kalamu/core";
  import type { OutlineStore } from "../lib/outline.svelte";
  import Breadcrumbs from "./Breadcrumbs.svelte";
  import OutlineNode from "./OutlineNode.svelte";

  interface Props {
    store: OutlineStore;
    /** Root crumb label while zoomed. */
    rootLabel: string;
  }

  let { store, rootLabel }: Props = $props();
</script>

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
  <Breadcrumbs {store} {rootLabel} />
  <div class="outline" role="list" aria-label="Outline">
    {#each store.displayRoots as node (node.id)}
      <OutlineNode {node} {store} />
    {/each}
  </div>
  <button class="tail" onclick={() => store.focusTail()} aria-label="Continue the outline">
    {#if store.displayRoots.length === 0 && store.filterTag === null}
      <span>Click here (or press Enter) to start your outline</span>
    {/if}
  </button>
{/if}

<style>
  .notice {
    color: var(--muted);
    font-size: 14px;
  }

  .filter-bar {
    margin: var(--filter-bar-margin, -6px 0 12px);
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
    /* TagChip's recipe. */
    color: light-dark(color-mix(in oklab, var(--tag-color) 60%, black), color-mix(in oklab, var(--tag-color) 65%, white));
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
    padding-left: var(--chevron-gutter);
  }

  /* Flex, top-aligned: a button centres its content by default, which left
     the empty-state prompt floating mid-screen. */
  .tail {
    flex: 1;
    min-height: var(--tail-min-height, 30vh);
    display: flex;
    align-items: flex-start;
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
