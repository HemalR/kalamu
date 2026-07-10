<script lang="ts">
  import { CLI_COMMANDS } from "../lib/cli-commands";
  import Overlay from "./Overlay.svelte";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();
</script>

<Overlay {onclose}>
  <!-- tabindex keeps clicks on panel text focused inside (see Overlay's focus-leave close) -->
  <div class="panel" role="dialog" aria-modal="true" aria-label="CLI commands" tabindex="-1">
    <header>
      <h2>CLI commands</h2>
      <button
        class="close"
        aria-label="Close"
        onclick={onclose}
        {@attach (element) => element.focus()}
      >×</button>
    </header>

    <dl class="list">
      {#each CLI_COMMANDS as command (command.name)}
        <dt><code>{command.name}</code></dt>
        <dd>{command.does}</dd>
      {/each}
    </dl>

    <p class="note">Run <code>kalamu &lt;command&gt; --help</code> for options.</p>
  </div>
</Overlay>

<style>
  .panel {
    width: 560px;
    max-width: 100%;
    max-height: 88vh;
    overflow-y: auto;
    padding: 18px 22px 22px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  h2 {
    font-size: 15px;
    font-weight: 600;
  }

  .close {
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--fg) 8%, transparent);
    color: var(--muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .close:hover {
    color: var(--fg);
  }

  .list {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 16px;
    row-gap: 7px;
    align-items: baseline;
  }

  dt {
    white-space: nowrap;
    text-align: right;
  }

  dd {
    font-size: 13px;
    color: var(--fg);
  }

  .note {
    margin-top: 16px;
    font-size: 12px;
    color: var(--muted);
  }

  code {
    display: inline-block;
    padding: 1.5px 6px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border: 1px solid var(--guide);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    color: var(--fg);
  }
</style>
