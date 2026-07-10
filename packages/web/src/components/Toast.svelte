<script lang="ts">
  interface Props {
    message: string | null;
  }

  let { message }: Props = $props();
</script>

{#if message !== null}
  <div class="toast" role="status">{message}</div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    max-width: min(480px, calc(100vw - 48px));
    padding: 8px 14px;
    border-radius: 8px;
    background: var(--toast-bg);
    color: var(--toast-fg);
    font-size: 13px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
    animation: rise 0.15s ease-out;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
