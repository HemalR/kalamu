<script lang="ts">
  import { SHORTCUTS, TOKEN_HINTS, type Shortcut } from "../lib/shortcuts";
  import Overlay from "./Overlay.svelte";

  interface Props {
    onclose: () => void;
  }

  let { onclose }: Props = $props();

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const entries: Shortcut[] = Object.values(SHORTCUTS);

  function keysFor(shortcut: Shortcut): string[] {
    return shortcut.keys
      .replaceAll("Mod", isMac ? "⌘" : "Ctrl")
      .replaceAll("Alt", isMac ? "⌥" : "Alt")
      .split("+");
  }
</script>

<Overlay {onclose}>
  <!-- tabindex keeps clicks on panel text focused inside (see Overlay's focus-leave close) -->
  <div class="panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabindex="-1">
    <header>
      <h2>Keyboard shortcuts</h2>
      <button
        class="close"
        aria-label="Close"
        onclick={onclose}
        {@attach (element) => element.focus()}
      >×</button>
    </header>

    <dl class="list">
      {#each entries as entry (entry.keys + entry.does)}
        <dt>
          {#each keysFor(entry) as part, index (index)}
            {#if index > 0}<span class="plus">+</span>{/if}<kbd>{part}</kbd>
          {/each}
        </dt>
        <dd>{entry.does}</dd>
      {/each}
    </dl>

    <h3>Inline tokens (parsed as you type a space, or on commit)</h3>
    <dl class="list">
      {#each TOKEN_HINTS as hint (hint.token)}
        <dt><code>{hint.token}</code></dt>
        <dd>{hint.does}</dd>
      {/each}
    </dl>
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

  h3 {
    margin: 18px 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
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

  .plus {
    margin: 0 2px;
    color: var(--muted);
    font-size: 11px;
  }

  kbd,
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
