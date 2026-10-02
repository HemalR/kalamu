<script lang="ts">
  import { dismissable } from "../lib/popover";
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
</script>

<span class="wrap" {@attach open && dismissable(() => (open = false))}>
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
    /* The raw palette colour on its own tint is ~1.5:1 for amber in light
       mode, so the text is the tag colour pulled toward black (light) or
       white (dark): ≥4.5:1 for the whole palette in both themes, checked by
       test/contrast.test.ts. The chip recipe everywhere a tag renders. */
    color: light-dark(color-mix(in oklab, var(--tag-color) 60%, black), color-mix(in oklab, var(--tag-color) 65%, white));
    background: color-mix(in srgb, var(--tag-color) 15%, transparent);
  }
  .chip:hover {
    background: color-mix(in srgb, var(--tag-color) 24%, transparent);
  }
</style>
