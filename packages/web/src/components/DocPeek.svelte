<script lang="ts">
  import { markdownSection } from "@kalamu/core";
  import { api } from "../lib/api";
  import { docUrl } from "../lib/segments";

  let { path, anchor }: { path: string; anchor?: string } = $props();

  const label = $derived(anchor === undefined ? path : `${path}#${anchor}`);

  type PeekState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; section: string | null };
  let state = $state<PeekState>({ status: "loading" });

  // Refetch whenever the reference changes; a toggle that outruns the fetch
  // must not paint the result of an earlier one.
  $effect(() => {
    let stale = false;
    state = { status: "loading" };
    api.getDoc(path).then(
      (source) => {
        if (!stale) state = { status: "ready", section: markdownSection(source, anchor) };
      },
      (error: unknown) => {
        if (!stale) state = { status: "error", message: error instanceof Error ? error.message : String(error) };
      },
    );
    return () => {
      stale = true;
    };
  });
</script>

<aside class="peek" aria-label="Peek at {label}">
  <a class="peek-head" href={docUrl(path, anchor)} target="_blank" rel="noreferrer">{label}</a>
  {#if state.status === "loading"}
    <p class="note">Loading {path}…</p>
  {:else if state.status === "error"}
    <p class="note">Couldn't load {path}: {state.message}</p>
  {:else if state.section === null}
    <p class="note">No heading #{anchor} in {path}</p>
  {:else}
    <!-- Markdown source shown verbatim, like the /docs/* viewer. -->
    <pre>{state.section}</pre>
  {/if}
</aside>

<style>
  .peek {
    margin: 2px 0 6px;
    padding-left: var(--text-col);
    color: var(--muted);
    font-size: 12px;
  }
  .peek-head {
    display: inline-block;
    margin-bottom: 2px;
    color: var(--muted);
    text-decoration: none;
  }
  .peek-head:hover {
    color: var(--fg);
    text-decoration: underline;
  }
  .note,
  pre {
    margin: 0;
    padding: 2px 0 2px 10px;
    border-left: 2px solid var(--guide);
  }
  pre {
    max-height: 320px;
    overflow: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
