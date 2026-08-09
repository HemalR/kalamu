<script lang="ts">
  import type { OutlineStore } from "../lib/outline.svelte";
  import ProgressBar from "./ProgressBar.svelte";

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
  {@const scope = store.progress.get(store.zoomNode.id) ?? { total: 0, done: 0, active: 0 }}
  <!-- Sticky inside the scrolling content column: rows scroll under it. -->
  <nav class="crumbs" aria-label="Zoom breadcrumbs">
    <button class="crumb" onclick={() => store.setZoom(null)}>{rootLabel}</button>
    {#each store.zoomPath as ancestor (ancestor.id)}
      <span class="sep" aria-hidden="true">›</span>
      <button class="crumb" onclick={() => store.setZoom(ancestor.id)}>{crumbLabel(ancestor.text)}</button>
    {/each}
    <span class="sep" aria-hidden="true">›</span>
    <span class="crumb current" aria-current="page">{crumbLabel(store.zoomNode.text)}</span>
    <!-- The scope's own total: zoomed in, the rows below are all you can see,
         so the trail is the only place left to say how much of it is done. The
         bar rows beneath cover its children. -->
    <span class="scope">
      <ProgressBar done={scope.done} active={scope.active} total={scope.total} caption />
    </span>
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

  /* Inline in the trail rather than under it — this is the scope readout. */
  .scope {
    display: flex;
    align-items: center;
    margin-left: 6px;
  }
</style>
