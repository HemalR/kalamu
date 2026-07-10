<script lang="ts" generics="T">
  import type { Snippet } from "svelte";

  /**
   * Caret-anchored completion list shared by OutlineNode's `@` and `#`
   * dropdowns. Purely presentational: the editor keeps focus and drives the
   * filter/highlight (see OutlineNode's combo state machine); this renders
   * the current matches and reports clicks.
   */
  interface Props {
    options: T[];
    /** Keyboard-highlighted index while focus stays in the editor. */
    highlighted: number;
    onpick: (option: T) => void;
    /** Accessible name for the list. */
    label: string;
    /** Row content for one option. */
    item: Snippet<[T]>;
  }

  let { options, highlighted, onpick, label, item }: Props = $props();
</script>

<!-- pointerdown preventDefault keeps focus (and the caret) in the editor while clicking -->
<div class="menu" role="listbox" aria-label={label} tabindex="-1" onpointerdown={(event) => event.preventDefault()}>
  {#each options as option, index (option)}
    <button
      class={["item", { active: index === highlighted }]}
      role="option"
      aria-selected={index === highlighted}
      onclick={() => onpick(option)}
    >
      {@render item(option)}
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
    max-height: 240px;
    overflow-y: auto;
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
  .item:hover,
  .item.active {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }
</style>
