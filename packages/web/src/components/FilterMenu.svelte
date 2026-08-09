<script lang="ts">
  import { ASSIGNEE_VALUES, CREATED_BY_VALUES, type AssigneeFilter } from "../lib/filter";
  import type { OutlineStore } from "../lib/outline.svelte";

  interface Props {
    store: OutlineStore;
  }

  let { store }: Props = $props();

  /** Same wording as the palette's Assign level, so all the surfaces read alike. */
  const LABELS: Record<AssigneeFilter, string> = {
    human: "Human",
    agent: "Agent",
    unassigned: "Unassigned",
  };

  let open = $state(false);
  let wrap = $state<HTMLElement>();
  let trigger = $state<HTMLButtonElement>();

  /** Closing on purpose (Escape, or the trigger again) hands focus back to the button. */
  function dismiss(): void {
    open = false;
    trigger?.focus();
  }

  /** Outside click: close, and let the click land wherever it was aimed. */
  function onWindowPointerDown(event: PointerEvent): void {
    if (wrap && event.target instanceof Node && !wrap.contains(event.target)) open = false;
  }

  /**
   * Escape closes the menu and nothing else: App's window handler would
   * otherwise read the same keypress as "clear the tag filter, then zoom out".
   */
  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.isComposing) return;
    event.stopPropagation();
    dismiss();
  }

  /** Tabbing (or clicking) out of the menu closes it, without stealing focus back. */
  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && wrap?.contains(next)) return;
    open = false;
  }
</script>

<svelte:window onpointerdown={open ? onWindowPointerDown : undefined} />

<div class="wrap" bind:this={wrap} onfocusout={open ? onFocusOut : undefined}>
  <button
    class={["trigger", { filtering: store.filtering }]}
    aria-label={store.filtering ? "Filters (active)" : "Filters"}
    aria-haspopup="dialog"
    aria-expanded={open}
    title={store.filtering ? "Filters — some items are hidden" : "Filter items"}
    bind:this={trigger}
    onclick={() => (open ? dismiss() : (open = true))}
  >
    <!-- funnel -->
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
    </svg>
    {#if store.filtering}<span class="dot" aria-hidden="true"></span>{/if}
  </button>

  {#if open}
    <!-- Escape is handled here rather than on window so it can be swallowed
         before App's global handler reads it as "clear filter / zoom out".
         The panel itself takes focus on open, which both makes that work and
         keeps a click on a label's text from blurring out of the menu. -->
    <div
      class="menu"
      role="dialog"
      aria-label="Filters"
      tabindex="-1"
      onkeydown={onMenuKeydown}
      {@attach (element: HTMLElement) => element.focus()}
    >
      <fieldset>
        <legend>Created by</legend>
        {#each CREATED_BY_VALUES as value (value)}
          <label>
            <!-- The two groups repeat "Human"/"Agent"; the aria-label keeps the
                 accessible names distinct without repeating the words on screen. -->
            <input
              type="checkbox"
              aria-label="Created by {LABELS[value]}"
              checked={store.showsCreatedBy(value)}
              onchange={() => store.toggleCreatedByFilter(value)}
            />
            <span>{LABELS[value]}</span>
          </label>
        {/each}
      </fieldset>

      <fieldset>
        <legend>Assigned to</legend>
        {#each ASSIGNEE_VALUES as value (value)}
          <label>
            <input
              type="checkbox"
              aria-label="Assigned to {LABELS[value]}"
              checked={store.showsAssignee(value)}
              onchange={() => store.toggleAssigneeFilter(value)}
            />
            <span>{LABELS[value]}</span>
          </label>
        {/each}
        <p class="note">Only tasks are assigned, so this never hides bullets or discussions.</p>
      </fieldset>

      <fieldset>
        <legend>Completed</legend>
        <label>
          <input type="checkbox" checked={!store.hideDone} onchange={() => store.toggleHideDone()} />
          <span>Show completed items</span>
        </label>
      </fieldset>

      <!-- Always enabled: disabling it the moment it works would blur focus out
           of the menu, and clearing nothing is a no-op anyway. -->
      <button class="reset" onclick={() => store.resetFilters()}>Clear filters</button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
  }

  /* Matches App's quiet ghost header buttons (scoped styles can't reach here). */
  .trigger {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .trigger:hover,
  .trigger.filtering {
    color: var(--fg);
  }

  /* Unmissable "something is hidden" marker. */
  .dot {
    position: absolute;
    top: 2px;
    right: 1px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--brand);
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 10;
    min-width: 200px;
    padding: 8px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.16);
    text-align: left;
  }
  /* The panel takes focus on open purely as a keyboard anchor — no ring. */
  .menu:focus {
    outline: none;
  }

  fieldset {
    margin: 0 0 8px;
    padding: 0;
    border: none;
  }
  fieldset:last-of-type {
    margin-bottom: 0;
  }

  legend {
    padding: 0 0 3px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  label {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 4px;
    border-radius: 5px;
    font-size: 12.5px;
    color: var(--fg);
    cursor: pointer;
    white-space: nowrap;
  }
  label:hover {
    background: color-mix(in srgb, var(--fg) 7%, transparent);
  }

  input {
    margin: 0;
    accent-color: var(--brand);
    cursor: pointer;
  }

  .note {
    margin: 4px 4px 0;
    max-width: 200px;
    font-size: 11px;
    line-height: 1.35;
    color: var(--muted);
    white-space: normal;
  }

  .reset {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 4px 0;
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
  .reset:hover {
    color: var(--fg);
  }
</style>
