<!--
  The row's priority column: the bars badge and the menu it opens. On EVERY
  row, bullets included, so text aligns vertically across kinds. On bullets the
  badge is always ghost; picking p1/p3 there converts the bullet to a task
  (settled SPEC behaviour, handled by core).
-->
<script lang="ts">
  import { DEFAULT_PRIORITY, type KalamuNode } from "@kalamu/core";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { dismissable } from "../lib/popover";
  import { PRIORITY_OPTIONS } from "../lib/vocab";
  import Menu from "./Menu.svelte";
  import PriorityBars from "./PriorityBars.svelte";

  let { node, store }: { node: KalamuNode; store: OutlineStore } = $props();

  // core's effectivePriority widens to number; the field is already 1|2|3, so
  // defaulting it here keeps the Priority type the badge and menu ask for.
  const priority = $derived(node.priority ?? DEFAULT_PRIORITY);

  let open = $state(false);
</script>

<span class="prio-wrap" {@attach open && dismissable(() => (open = false))}>
  <button
    class={["prio", { ghost: priority === 2 || node.kind === "bullet" }]}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Priority p{priority} — set priority"
    title={node.kind === "bullet" ? "Set priority (makes this a task)" : "Set priority"}
    tabindex="-1"
    onclick={() => (open = !open)}
  >
    <PriorityBars {priority} />
  </button>
  {#if open}
    <Menu
      options={PRIORITY_OPTIONS}
      label="Priority"
      checked={(option) => option.value === priority}
      onpick={(picked) => {
        store.setPriority(node.id, picked.value);
        open = false;
      }}
    >
      {#snippet item(option)}
        <PriorityBars priority={option.value} />
        {option.label}
      {/snippet}
    </Menu>
  {/if}
</span>

<style>
  .prio-wrap {
    position: relative;
    flex: none;
    width: var(--prio-col);
    height: 26px;
    display: flex;
    align-items: center;
    margin-right: var(--prio-gap);
  }
  /* Touch: 32px tall, given back as negative margin (see NodeGlyph). */
  @media (pointer: coarse) {
    .prio-wrap {
      height: 32px;
      margin-block: -3px;
    }
  }

  /* The bars carry the signal, so the button is bare chrome — it fills the
     gutter purely to give the 11px glyph a comfortable hit area. */
  .prio {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    cursor: pointer;
  }
  /* Default (p2) — and any bullet — shows no badge, only a ghost affordance
     on hover/focus. An invisible ghost takes no taps either: on a touch screen
     (no hover) a tap meant for the text must not open a menu nobody can see,
     so there the ghost belongs to the row holding the caret. */
  .prio.ghost {
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
  }
  :global(.row:hover) .prio.ghost,
  :global(.row:focus-within) .prio.ghost,
  .prio.ghost[aria-expanded="true"] {
    opacity: 0.5;
    pointer-events: auto;
  }
</style>
