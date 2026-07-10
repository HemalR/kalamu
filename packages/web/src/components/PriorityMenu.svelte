<script lang="ts">
  interface Props {
    /** Effective priority (missing stored priority = 3). */
    current: number;
    /** 3 means "back to default" (stored priority cleared). */
    onpick: (priority: 1 | 2 | 3 | 4 | 5) => void;
  }

  let { current, onpick }: Props = $props();

  const options = [
    { p: 1, label: "p1 · urgent" },
    { p: 2, label: "p2 · high" },
    { p: 3, label: "p3 · normal (default)" },
    { p: 4, label: "p4 · below normal" },
    { p: 5, label: "p5 · low" },
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
      <span class={["swatch", `p${option.p}`]} aria-hidden="true"></span>
      <span class="label">{option.label}</span>
      {#if current === option.p}<span class="tick" aria-hidden="true">✓</span>{/if}
    </button>
  {/each}
  <button class="clear" role="menuitem" onclick={() => onpick(3)}>clear (default)</button>
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

  .swatch {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
  }
  .swatch.p1 {
    background: var(--p1);
  }
  .swatch.p2 {
    background: var(--p2);
  }
  .swatch.p3 {
    background: var(--bullet);
  }

  .clear {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 3px 8px;
    border: none;
    border-top: 1px solid var(--guide);
    border-radius: 0 0 5px 5px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
  }
  .clear:hover {
    color: var(--fg);
  }
</style>
