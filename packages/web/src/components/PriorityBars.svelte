<script lang="ts">
  import type { Priority } from "../lib/api";

  interface Props {
    /** Effective priority (missing stored priority = 2). */
    priority: Priority;
  }

  let { priority }: Props = $props();

  /*
   * Signal-strength glyph: shortest bar first, contrast rising with height so
   * the ramp reads as weight rather than colour (greys only — red is reserved
   * elsewhere, and a hue would fight the tag chips). Higher priority fills
   * more bars, which means only p1 reaches the tall, highest-contrast one.
   */
  const BARS = [
    { x: 0, y: 6, height: 5, ink: 32 },
    { x: 4.25, y: 3, height: 8, ink: 55 },
    { x: 8.5, y: 0, height: 11, ink: 85 },
  ];

  /** Unfilled bars stay as a faint track so the footprint never shifts. */
  const TRACK = 12;

  const filled = $derived(4 - priority);
</script>

<svg viewBox="0 0 11 11" width="11" height="11" aria-hidden="true">
  {#each BARS as bar, i (i)}
    <rect
      x={bar.x}
      y={bar.y}
      width="2.5"
      height={bar.height}
      rx="1.25"
      style:fill="color-mix(in srgb, var(--fg) {i < filled ? bar.ink : TRACK}%, transparent)"
    />
  {/each}
</svg>

<style>
  svg {
    display: block; /* no baseline gap — callers centre this in a flex row */
    flex: none;
  }
</style>
