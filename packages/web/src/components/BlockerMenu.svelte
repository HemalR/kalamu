<script lang="ts">
  import type { KalamuNode } from "@kalamu/core";
  import { candidateLabel } from "../lib/task-state";

  interface Props {
    /** The OPEN blockers only, in `blockedBy` order — what the badge counts. */
    blockers: readonly KalamuNode[];
    onpick: (blocker: KalamuNode) => void;
  }

  let { blockers, onpick }: Props = $props();
</script>

<!-- Shown only when a node waits on more than one thing; a single blocker is
     jumped to straight from the badge, with no choice to make. -->
<div class="menu" role="menu" aria-label="Go to blocker">
  {#each blockers as blocker (blocker.id)}
    <!-- candidateLabel, so a row reads like the palette's "Block on…" rows and a
         400-character node still occupies exactly one line. Ids stay internal. -->
    <button class="item" role="menuitem" onclick={() => onpick(blocker)}>{candidateLabel(blocker)}</button>
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
    display: block;
    /* Wider than the assign/priority menus: these rows carry node text, not a
       fixed vocabulary. The cap keeps the menu from spanning the window. */
    max-width: 280px;
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
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item:hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }
</style>
