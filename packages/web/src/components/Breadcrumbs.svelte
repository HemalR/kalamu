<script lang="ts">
  import type { OutlineStore } from "../lib/outline.svelte";

  interface Props {
    store: OutlineStore;
    /** Root crumb label — the project name when loaded. */
    rootLabel: string;
  }

  let { store, rootLabel }: Props = $props();

  /** A blank node still needs a visible crumb. */
  function crumbLabel(text: string): string {
    return text.trim() === "" ? "…" : text;
  }
</script>

{#if store.zoomNode !== null}
  <!-- Sticky inside the scrolling content column: rows scroll under it. -->
  <nav class="crumbs" aria-label="Zoom breadcrumbs">
    <button class="crumb" onclick={() => store.setZoom(null)}>{rootLabel}</button>
    {#each store.zoomPath as ancestor (ancestor.id)}
      <span class="sep" aria-hidden="true">›</span>
      <button class="crumb" onclick={() => store.setZoom(ancestor.id)}>{crumbLabel(ancestor.text)}</button>
    {/each}
    <span class="sep" aria-hidden="true">›</span>
    <span class="crumb current" aria-current="page">{crumbLabel(store.zoomNode.text)}</span>
  </nav>
{/if}

<style>
  .crumbs {
    position: sticky;
    top: 0;
    z-index: 10; /* above the outline rows (combo menus sit at the row level) */
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    margin: -6px 0 10px;
    padding: 8px 0;
    background: var(--bg);
    font-size: 12.5px;
    user-select: none;
  }

  .crumb {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 2px 4px;
    border: none;
    border-radius: 4px;
    background: none;
    font: inherit;
    line-height: 1.4;
    color: var(--muted);
  }
  button.crumb {
    cursor: pointer;
  }
  button.crumb:hover {
    color: var(--fg);
  }

  .crumb.current {
    color: var(--fg);
    font-weight: 500;
  }

  .sep {
    color: var(--muted);
    opacity: 0.6;
  }
</style>
