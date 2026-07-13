<script lang="ts">
  import { TAG_PALETTE } from "@kalamu/core";

  interface Props {
    /** Lowercase tag name (for the filter action label); omit with onfilter
        for a plain colour picker. */
    tag?: string;
    /** The current colour (override or hash-derived). */
    color: string;
    /** A palette hex, or null for "default" (clears the override). */
    onpick: (color: string | null) => void;
    onfilter?: () => void;
  }

  let { tag, color, onpick, onfilter }: Props = $props();
</script>

<div class="popover" role="dialog" aria-label={onfilter ? "Tag actions" : "Choose colour"}>
  {#if tag !== undefined && onfilter !== undefined}
    <button class="filter" onclick={onfilter}>Filter by <strong>#{tag}</strong></button>
  {/if}
  <div class="swatches">
    {#each TAG_PALETTE as swatch (swatch)}
      <button
        class={["swatch", { active: swatch.toLowerCase() === color.toLowerCase() }]}
        style:background={swatch}
        aria-label="Use colour {swatch}"
        onclick={() => onpick(swatch)}
      ></button>
    {/each}
  </div>
  <button class="default" onclick={() => onpick(null)}>default colour</button>
</div>

<style>
  .popover {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: 10;
    padding: 8px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  }

  .filter {
    display: block;
    width: 100%;
    margin-bottom: 8px;
    padding: 4px 6px;
    border: 1px solid var(--guide);
    border-radius: 5px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .filter:hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(6, 18px);
    gap: 6px;
  }

  .swatch {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
  .swatch:hover {
    transform: scale(1.15);
  }
  .swatch.active {
    box-shadow:
      0 0 0 2px var(--panel),
      0 0 0 3.5px var(--fg);
  }

  .default {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 3px 0;
    border: 1px solid var(--guide);
    border-radius: 5px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
  }
  .default:hover {
    color: var(--fg);
  }
</style>
