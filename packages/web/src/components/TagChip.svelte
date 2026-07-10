<script lang="ts">
  import ColorPopover from "./ColorPopover.svelte";

  interface Props {
    /** Chip label — the tag as typed, without the leading #. */
    tag: string;
    color: string;
    onSetColor: (color: string | null) => void;
    onFilter: () => void;
  }

  let { tag, color, onSetColor, onFilter }: Props = $props();

  let open = $state(false);
  let wrap: HTMLElement | undefined = $state();

  function onWindowPointerDown(event: PointerEvent): void {
    if (wrap && event.target instanceof Node && !wrap.contains(event.target)) open = false;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") open = false;
  }
</script>

<svelte:window
  onpointerdown={open ? onWindowPointerDown : undefined}
  onkeydown={open ? onWindowKeydown : undefined}
/>

<span class="wrap" bind:this={wrap}>
  <button
    class="chip"
    style:--tag-color={color}
    aria-haspopup="dialog"
    aria-expanded={open}
    title="Change colour of #{tag.toLowerCase()}"
    onclick={() => (open = !open)}
  >
    {tag}
  </button>
  {#if open}
    <ColorPopover
      tag={tag.toLowerCase()}
      {color}
      onpick={(picked) => {
        onSetColor(picked);
        open = false;
      }}
      onfilter={() => {
        onFilter();
        open = false;
      }}
    />
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
    vertical-align: baseline;
  }

  .chip {
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    padding: 2.5px 7px;
    border-radius: 999px;
    color: var(--tag-color);
    background: color-mix(in srgb, var(--tag-color) 15%, transparent);
  }
  .chip:hover {
    background: color-mix(in srgb, var(--tag-color) 24%, transparent);
  }
</style>
