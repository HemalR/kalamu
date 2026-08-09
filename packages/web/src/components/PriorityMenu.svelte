<script lang="ts">
  import type { Priority } from "../lib/api";
  import PriorityBars from "./PriorityBars.svelte";

  interface Props {
    /** Effective priority (missing stored priority = 2). */
    current: Priority;
    /** 2 means "back to default" (stored priority cleared). */
    onpick: (priority: Priority) => void;
  }

  let { current, onpick }: Props = $props();

  const options = [
    { p: 1, label: "p1 · high" },
    { p: 2, label: "p2 · medium (default)" },
    { p: 3, label: "p3 · low" },
  ] as const;
</script>

<div class="menu" role="menu" aria-label="Priority">
  {#each options as option (option.p)}
    <button
      class="item"
      role="menuitemradio"
      aria-checked={current === option.p}
      onclick={() => onpick(option.p)}
    >
      <PriorityBars priority={option.p} />
      <span class="label">{option.label}</span>
      {#if current === option.p}<span class="tick" aria-hidden="true">✓</span>{/if}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: 10;
    min-width: 168px;
    padding: 4px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .item:hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }

  .label {
    flex: 1;
  }

  .tick {
    font-size: 11px;
    color: var(--muted);
  }
</style>
