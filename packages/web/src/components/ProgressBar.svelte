<script lang="ts">
  import { dashCounts } from "../lib/dashes";

  interface Props {
    /** Finished actionable units in the subtree. */
    done: number;
    /** Claimed but unfinished units (`startedAt` set, no `doneAt`). */
    active: number;
    /** Actionable units in the subtree; 0 renders nothing. */
    total: number;
    /**
     * Offer the exact `3/7 (43%)` readout after the dashes. Only an offer: a
     * bar with nothing done still draws bare (see `showCaption`).
     */
    caption?: boolean;
  }

  let { done, active, total, caption = false }: Props = $props();

  /*
   * Segmented progress, Linear/Things style: a strip of small dashes, done
   * first, then in-progress, then the untouched remainder. The dashes keep
   * full colour at rest — this is the ambient signal, and a faint one reads as
   * nothing at all. Only the caption comes and goes.
   */
  type Dash = "done" | "active" | "rest";

  const fill = (kind: Dash, count: number): Dash[] => Array.from({ length: count }, () => kind);

  const counts = $derived(dashCounts(done, active, total));
  const dashes = $derived([
    ...fill("done", counts.done),
    ...fill("active", counts.active),
    ...fill("rest", counts.rest),
  ]);
  const percent = $derived(total === 0 ? 0 : Math.round((done / total) * 100));
  /**
   * Nothing finished yet: the dashes already say so, and "0/3 (0%)" is noise on
   * a section that has not started. The numbers earn their space only once
   * there is progress to report — so the caller offering a caption is
   * necessary, not sufficient.
   */
  const showCaption = $derived(caption && done > 0);
  /* One announcement for the whole strip — twenty labelled dashes would be
     unusable — and it always carries the full counts, hidden caption or not. */
  const label = $derived(`${done} of ${total} done${active > 0 ? `, ${active} in progress` : ""}`);
</script>

{#if total > 0}
  <!-- `bare` is for the parent meta row: a separator dot after a dash strip
       reads as one more dash, so OutlineNode suppresses the next item's
       divider only while the caption (real text) is away. -->
  <span class={["bar", { bare: !showCaption }]} role="img" aria-label={label}>
    <span class="dashes" aria-hidden="true">
      <!-- Keyed by position: a dash has no identity beyond where it sits, and
           the kinds repeat, so nothing else could key this. -->
      {#each dashes as kind, index (index)}
        <span class={["dash", kind]}></span>
      {/each}
    </span>
    {#if showCaption}
      <span class="caption">{done}/{total} ({percent}%)</span>
    {/if}
  </span>
{/if}

<style>
  .bar {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    user-select: none;
  }

  .dashes {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .dash {
    width: 10px;
    height: 5px;
    border-radius: 2px;
    background: var(--ring);
  }
  .dash.done {
    background: var(--progress-done);
  }
  .dash.active {
    background: var(--progress-active);
  }

  .caption {
    font-size: 11px;
    line-height: 1;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
