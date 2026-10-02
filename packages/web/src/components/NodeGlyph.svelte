<!--
  The row's leading glyph: a task's checkbox, a discussion's speech bubble
  (SPEC key decision 12) — both toggle done — or a bullet's dot, which doubles
  as its zoom target (Workflowy-style); keyboard and breadcrumbs cover zooming
  the other kinds. `ringed` marks a collapsed node with hidden children.
-->
<script lang="ts">
  import type { KalamuNode } from "@kalamu/core";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { isStarted } from "../lib/task-state";

  interface Props {
    node: KalamuNode;
    store: OutlineStore;
    ringed: boolean;
    /** A numbered bullet's marker is its ordinal; the dot only surfaces on hover. */
    numbered: boolean;
  }

  let { node, store, ringed, numbered }: Props = $props();

  const done = $derived(node.doneAt !== null);
  // An agent's claim (SPEC key decision 17): the checkbox holds a slowly pulsing
  // amber dot — the UI's equivalent of the `▶` the CLI prints — so an in-progress
  // task or discussion never reads as merely open.
  const started = $derived(isStarted(node));
  const title = $derived(
    started && node.startedAt !== undefined ? `In progress since ${new Date(node.startedAt).toLocaleString()}` : undefined,
  );
</script>

{#if node.kind === "bullet"}
  <button
    class={["glyph", "dot", { ringed, numbered }]}
    aria-label="Zoom in"
    title="Zoom in"
    tabindex="-1"
    onclick={() => store.zoomIn(node.id)}
  ></button>
{:else}
  <button
    class={["glyph", node.kind === "task" ? "check" : "bubble", { ringed, started, done }]}
    role="checkbox"
    aria-checked={done}
    aria-label={done ? `Reopen ${node.kind}` : `Mark ${started ? "in-progress " : ""}${node.kind} done`}
    {title}
    tabindex="-1"
    onclick={() => store.toggleDone(node.id)}
  >
    {#if node.kind === "discussion"}
      <!-- Lucide messages-square, restroked to match the row's other icons; done fills the front bubble, like the filled done checkbox. -->
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
          fill={done ? "currentColor" : "none"}
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"
          fill="none"
          stroke="currentColor"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    {:else if done}
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
        <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
      </svg>
    {:else if started}
      <span class="pulse" aria-hidden="true"></span>
    {/if}
  </button>
{/if}

<style>
  .glyph {
    flex: none;
    width: var(--glyph-col);
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
  /* Touch: a 32px-tall target. The extra height comes back as negative
     margin, so the row's layout is exactly the mouse layout. */
  @media (pointer: coarse) {
    .glyph {
      height: 32px;
      margin: -3px 0;
    }
  }

  .dot::before {
    content: "";
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bullet);
    transition: transform 0.1s;
  }
  /* Collapsed: a darker dot inside a halo. Hover only darkens and grows the
     dot (it is the zoom target) — no halo — so a hovered bullet never reads
     as a folded one. */
  .dot.ringed::before {
    background: var(--muted);
    box-shadow: 0 0 0 3.5px var(--ring-collapsed);
  }
  .dot:hover::before {
    background: var(--muted);
    transform: scale(1.35);
  }
  /* A numbered bullet's marker is its ordinal; the dot only surfaces on hover
     (it is still the zoom target). Collapsed stays visible: the ring is the
     only sign that children are folded. */
  .dot.numbered:not(:hover):not(.ringed)::before {
    opacity: 0;
  }

  .check {
    position: relative; /* the checkmark svg / pulsing dot overlays the ::after box */
    color: transparent;
  }
  .check::after {
    content: "";
    width: 12px;
    height: 12px;
    border: 1.5px solid var(--check-border);
    border-radius: 3.5px;
    box-sizing: border-box;
  }
  .check.ringed::after {
    box-shadow: 0 0 0 3px var(--ring-collapsed);
  }
  .check svg,
  .check .pulse {
    position: absolute;
    z-index: 1;
  }
  /* Claimed and still open: the box keeps its outline (the work isn't done) and
     holds a breathing amber dot. It reports what the CLI reports by printing
     `▶` — the same claim, said the way a live surface can say it. */
  .check.started::after {
    border-color: var(--started);
  }
  .pulse {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--started);
    /* opacity + transform only: this animates on the compositor, so a screenful
       of claimed tasks costs no layout or paint work per frame. */
    animation: breathe 1.8s ease-in-out infinite;
  }
  @keyframes breathe {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.45;
      transform: scale(0.8);
    }
  }
  .check.done {
    color: var(--bg);
  }
  .check.done::after {
    background: var(--done);
    border-color: var(--done);
  }

  .bubble {
    color: var(--check-border);
  }
  .bubble svg {
    border-radius: 4px;
  }
  .bubble.ringed svg {
    box-shadow: 0 0 0 3px var(--ring-collapsed);
  }
  /* Claimed and still open: the bubble turns the claim colour and breathes,
     the same signal the checkbox's dot gives on a task. */
  .bubble.started {
    color: var(--started);
  }
  .bubble.started svg {
    animation: breathe 1.8s ease-in-out infinite;
  }
  .bubble.done {
    color: var(--done);
  }

  /* Reduced motion: the dot still has to say "claimed", so it stays — it just
     stops breathing. */
  @media (prefers-reduced-motion: reduce) {
    .pulse,
    .bubble.started svg {
      animation: none;
    }
  }
</style>
