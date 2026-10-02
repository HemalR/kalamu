<!--
  The store's transient message, with its optional action (Undo after a
  delete or a clean-up). The role="status" region stays mounted and only its
  content changes: screen readers often skip a live region that is inserted
  together with its first message.
-->
<script lang="ts">
  import type { Toast } from "../lib/document.svelte";

  interface Props {
    toast: Toast | null;
    /** The action ran: the toast has said its piece. */
    ondismiss: () => void;
  }

  let { toast, ondismiss }: Props = $props();
</script>

<div class="region" role="status">
  {#if toast !== null}
    <!-- Keyed by the toast itself, so each new message rises in afresh. -->
    {#key toast}
      <div class="toast">
        <span>{toast.message}</span>
        {#if toast.action}
          {@const action = toast.action}
          <button
            onclick={() => {
              action.run();
              ondismiss();
            }}>{action.label}</button
          >
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .region {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-toast);
    width: max-content;
    max-width: min(480px, calc(100vw - 48px));
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 14px;
    border-radius: 8px;
    background: var(--toast-bg);
    color: var(--toast-fg);
    font-size: 13px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    pointer-events: auto;
    animation: rise 0.15s ease-out;
  }

  /* Inverse of the page, so the action takes the toast's own ink. */
  button {
    flex: none;
    margin: -4px -6px -4px 0;
    padding: 4px 8px;
    border: none;
    border-radius: 5px;
    background: color-mix(in srgb, var(--toast-fg) 14%, transparent);
    color: var(--toast-fg);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    background: color-mix(in srgb, var(--toast-fg) 24%, transparent);
  }
  @media (pointer: coarse) {
    button {
      min-height: 32px;
      margin-block: -8px;
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
