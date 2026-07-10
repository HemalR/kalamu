<script module lang="ts">
  import type { Assignee } from "@kalamu/core";

  /**
   * Assignees whose name starts with `filter` (case-insensitive). Shared with
   * OutlineNode's @ dropdown so its close-on-non-match rule and its option
   * list can never disagree.
   */
  export function matchAssignees(filter: string): Assignee[] {
    const query = filter.toLowerCase();
    return (["human", "agent"] as const).filter((option) => option.startsWith(query));
  }

  export function isAssignee(value: string): value is Assignee {
    return value === "human" || value === "agent";
  }

  /** Same wording as the palette's Assign level, so all assign surfaces read alike. */
  export const ASSIGNEE_LABELS: Record<Assignee, string> = {
    human: "Human — agents skip the task",
    agent: "Agent",
  };

  export { assigneeIcon };
</script>

<script lang="ts">
  interface Props {
    /** Current assignee; null = unassigned. */
    current?: Assignee | null;
    /** null = clear back to unassigned. */
    onpick: (assignee: Assignee | null) => void;
  }

  let { current = null, onpick }: Props = $props();
</script>

{#snippet assigneeIcon(kind: Assignee)}
  {#if kind === "human"}
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="5" r="2.8" fill="currentColor" />
      <path d="M2.5 13.4a5.6 5.6 0 0 1 11 0c0 .4-.3.6-.6.6H3.1c-.3 0-.6-.2-.6-.6z" fill="currentColor" />
    </svg>
  {:else}
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="6" width="10" height="7" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M8 6V3.6" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="8" cy="2.6" r="1.1" fill="currentColor" />
      <circle cx="6" cy="9.5" r="1" fill="currentColor" />
      <circle cx="10" cy="9.5" r="1" fill="currentColor" />
    </svg>
  {/if}
{/snippet}

<!-- The assignee-marker menu (the @ caret dropdown renders through ComboMenu instead). -->
<div class="menu" role="menu" aria-label="Assign" tabindex="-1" onpointerdown={(event) => event.preventDefault()}>
  {#each matchAssignees("") as option (option)}
    <button class="item" role="menuitemradio" aria-checked={current === option} onclick={() => onpick(option)}>
      <span class="icon" aria-hidden="true">{@render assigneeIcon(option)}</span>
      <span class="label">{ASSIGNEE_LABELS[option]}</span>
      {#if current === option}<span class="tick" aria-hidden="true">✓</span>{/if}
    </button>
  {/each}
  <button class="clear" role="menuitem" onclick={() => onpick(null)}>clear (unassigned)</button>
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

  .icon {
    display: flex;
    color: var(--muted);
  }

  .label {
    flex: 1;
  }

  .tick {
    font-size: 11px;
    color: var(--muted);
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
