<!-- The human / robot glyph for an assignee, shared by the meta-row badge and every assign menu. -->
<script lang="ts">
  import type { Assignee } from "@kalamu/core";

  let { assignee }: { assignee: Assignee } = $props();
</script>

{#if assignee === "human"}
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
