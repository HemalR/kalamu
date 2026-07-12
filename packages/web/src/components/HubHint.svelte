<script lang="ts">
  /**
   * Hub-discovery footer (SPEC "Hub > Discovery"): one quiet, dismissible
   * hint per page load, picked uniformly at random among the messages that
   * are eligible for this mode/platform and not yet dismissed. Nothing ever
   * renders once the hub login item is installed. Sticky-in-flow at the end
   * of the content column, so it pins to the viewport bottom while scrolling
   * but rests below the outline at full scroll.
   */
  import { apiBase, type ProjectInfo } from "../lib/api";
  import { writeClipboard } from "../lib/copy";
  import type { OutlineStore } from "../lib/outline.svelte";

  let { store, project }: { store: OutlineStore; project: ProjectInfo | null } = $props();

  interface Hint {
    id: "hub" | "open-install" | "hub-install";
    /** Sentence before the copy chip; `mention` renders as inline code mid-sentence. */
    lead: string;
    mention?: string;
    rest?: string;
    /** The actionable command — rendered as a click-to-copy chip. */
    command: string;
    eligible: (standalone: boolean, platform: string) => boolean;
  }

  const HINTS: Hint[] = [
    {
      id: "hub",
      lead: "Running multiple projects? See a unified view of all your Kalamus by running",
      command: "kalamu hub",
      eligible: (standalone) => standalone,
    },
    {
      id: "open-install",
      lead: "Tired of running",
      mention: "kalamu open",
      rest: "? Keep Kalamu ever-ready with",
      command: "kalamu hub install",
      eligible: (standalone, platform) => standalone && platform === "darwin",
    },
    {
      id: "hub-install",
      lead: "Tired of running",
      mention: "kalamu hub",
      rest: " every time? Keep Kalamu ever-ready with",
      command: "kalamu hub install",
      eligible: (standalone, platform) => !standalone && platform === "darwin",
    },
  ];

  /** Guarded like api.ts's `location` check so Node-side tooling can import this. */
  function isDismissed(id: Hint["id"]): boolean {
    if (typeof localStorage === "undefined") return true;
    if (localStorage.getItem(`kalamu:hint-dismissed:${id}`) === "1") return true;
    // Legacy single-hint key from before the catalog existed; read-only migration.
    return id === "hub" && localStorage.getItem("kalamu:hub-hint-dismissed") === "1";
  }

  // Evaluates once per page load: `project` only ever transitions null → value.
  const hint = $derived.by((): Hint | null => {
    if (project === null || project.hubInstalled) return null;
    const eligible = HINTS.filter((h) => h.eligible(apiBase === "", project.platform) && !isDismissed(h.id));
    return eligible[Math.floor(Math.random() * eligible.length)] ?? null;
  });

  /** Dismissing hides the footer for this session; siblings surface on the next load. */
  let hidden = $state(false);

  function dismiss(shown: Hint): void {
    hidden = true;
    try {
      localStorage.setItem(`kalamu:hint-dismissed:${shown.id}`, "1");
    } catch {
      // storage unavailable (e.g. private mode) — hide for this session only
    }
  }

  function copyCommand(shown: Hint): void {
    writeClipboard(shown.command).then(
      () => store.showToast(`Copied ${shown.command}`),
      () => store.showToast("could not access the clipboard"),
    );
  }
</script>

{#if hint !== null && !hidden}
  <footer class="hub-hint">
    <p>
      {hint.lead}
      {#if hint.mention !== undefined}<code>{hint.mention}</code>{hint.rest}{/if}
      <button class="code" title="Copy to clipboard" onclick={() => copyCommand(hint)}>{hint.command}</button>
    </p>
    <button class="dismiss" aria-label="Dismiss" onclick={() => dismiss(hint)}>×</button>
  </footer>
{/if}

<style>
  .hub-hint {
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

  code,
  .code {
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--guide);
    color: inherit;
    font-family: ui-monospace, "SF Mono", SFMono-Regular, "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 11.5px;
  }

  .code {
    border: none;
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
