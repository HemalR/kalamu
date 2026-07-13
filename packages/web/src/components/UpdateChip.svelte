<script lang="ts">
  /**
   * "Update available" footer (SPEC key decision 14): a quiet, dismissible
   * one-liner shown when the running CLI is behind the latest npm release.
   * Independent of HubHint. Dismissal is keyed to the latest version, so a
   * dismissed chip returns the next time a newer release ships. Sticky-in-flow
   * like HubHint, so it pins to the viewport bottom while scrolling.
   */
  import type { ProjectInfo } from "../lib/api";
  import { writeClipboard } from "../lib/copy";
  import type { OutlineStore } from "../lib/outline.svelte";

  let { store, project }: { store: OutlineStore; project: ProjectInfo | null } = $props();

  const COMMAND = "npm i -g kalamu@latest";

  /** Guarded like api.ts's `location` check so Node-side tooling can import this. */
  function isDismissed(version: string): boolean {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(`kalamu:update-dismissed:${version}`) === "1";
  }

  // `project` only ever transitions null → value; re-evaluates if latestVersion changes.
  const show = $derived(
    project !== null && project.updateAvailable && project.latestVersion !== null && !isDismissed(project.latestVersion),
  );

  /** Dismissing hides the chip for this version; a newer release surfaces it again. */
  let hidden = $state(false);

  function dismiss(version: string): void {
    hidden = true;
    try {
      localStorage.setItem(`kalamu:update-dismissed:${version}`, "1");
    } catch {
      // storage unavailable (e.g. private mode) — hide for this session only
    }
  }

  function copyCommand(): void {
    writeClipboard(COMMAND).then(
      () => store.showToast(`Copied ${COMMAND}`),
      () => store.showToast("could not access the clipboard"),
    );
  }
</script>

{#if show && !hidden && project !== null && project.latestVersion !== null}
  <footer class="update-chip">
    <p>
      Kalamu {project.latestVersion} is available (you're on {project.version}).
      <button class="code" title="Copy to clipboard" onclick={copyCommand}>{COMMAND}</button>
    </p>
    <button class="dismiss" aria-label="Dismiss" onclick={() => dismiss(project?.latestVersion ?? "")}>×</button>
  </footer>
{/if}

<style>
  .update-chip {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 760px;
    margin: 0 auto;
    padding: 7px 32px;
    border-top: 1px solid var(--guide);
    background: var(--bg);
    font-size: 12px;
    color: var(--muted);
    user-select: none;
  }

  p {
    flex: 1;
    min-width: 0;
  }

  .code {
    padding: 1px 5px;
    border: none;
    border-radius: 4px;
    background: var(--guide);
    color: inherit;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 11.5px;
    cursor: pointer;
  }
  .code:hover {
    color: var(--fg);
  }

  .dismiss {
    flex-shrink: 0;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 14px;
    line-height: 1;
  }
  .dismiss:hover {
    color: var(--fg);
  }
</style>
