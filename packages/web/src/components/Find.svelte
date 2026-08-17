<script lang="ts">
  import { pathOf, searchNodes } from "@kalamu/core";
  import { parseFindIntent, resolveNodeId } from "../lib/find";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { candidateLabel } from "../lib/task-state";
  import Overlay from "./Overlay.svelte";

  interface Props {
    store: OutlineStore;
    onclose: () => void;
  }

  let { store, onclose }: Props = $props();

  let query = $state("");
  let selected = $state(0);
  let listEl: HTMLDivElement | undefined;

  function registerList(element: HTMLDivElement): () => void {
    listEl = element;
    return () => {
      if (listEl === element) listEl = undefined;
    };
  }

  interface Hit {
    id: string;
    label: string;
    path: string;
    /** An id query zooms (follows the kalamu link); text search reveals in place. */
    via: "id" | "text";
  }

  const result = $derived.by((): { hits: Hit[]; missingId: boolean } => {
    const intent = parseFindIntent(query);
    if (intent.kind === "empty") return { hits: [], missingId: false };
    if (intent.kind === "id") {
      const id = resolveNodeId(intent.token, store.tree.byId, (token) => store.localId(token));
      if (id === null) return { hits: [], missingId: true };
      const node = store.tree.byId.get(id);
      if (node === undefined) return { hits: [], missingId: true };
      return {
        hits: [{ id, label: candidateLabel(node), path: pathOf(store.tree, node).join(" › "), via: "id" }],
        missingId: false,
      };
    }
    return {
      hits: searchNodes(store.nodes, intent.needle).map((node) => ({
        id: node.id,
        label: candidateLabel(node),
        path: pathOf(store.tree, node).join(" › "),
        via: "text" as const,
      })),
      missingId: false,
    };
  });

  const hits = $derived(result.hits);
  const active = $derived(hits.length === 0 ? 0 : Math.min(selected, hits.length - 1));
  const activeId = $derived(hits[active]?.id);

  function go(hit: Hit): void {
    onclose();
    if (hit.via === "id") store.zoomIn(hit.id);
    else store.revealNode(hit.id);
  }

  function submit(): void {
    const hit = hits[active];
    if (hit !== undefined) go(hit);
  }

  function dismiss(): void {
    onclose();
    if (store.lastFocusedId !== null) void store.focus(store.lastFocusedId, "end");
  }

  function move(delta: number): void {
    if (hits.length === 0) return;
    selected = (active + delta + hits.length) % hits.length;
    const row = listEl?.children[selected];
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }

  function onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData("text") ?? "";
    const intent = parseFindIntent(text);
    if (intent.kind !== "id") return;
    event.preventDefault();
    const id = resolveNodeId(intent.token, store.tree.byId, (token) => store.localId(token));
    if (id !== null) {
      const node = store.tree.byId.get(id);
      if (node !== undefined) {
        go({ id, label: candidateLabel(node), path: "", via: "id" });
        return;
      }
    }
    query = text.trim();
    selected = 0;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    }
  }
</script>

<Overlay top="12vh" onclose={dismiss} onescape={dismiss}>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Find" tabindex="-1" {onkeydown}>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <input
        type="search"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="Find by text or paste a node id"
        aria-label="Find"
        aria-autocomplete="list"
        aria-controls="find-hits"
        aria-activedescendant={activeId === undefined ? undefined : `find-hit-${activeId}`}
        bind:value={query}
        oninput={() => (selected = 0)}
        onpaste={onPaste}
        {@attach (element: HTMLInputElement) => {
          element.focus();
        }}
      />
    </form>

    {#if query.trim() === ""}
      <p class="hint">Search item text, or paste a node id or kalamu link to jump there.</p>
    {:else if result.missingId}
      <p class="hint">No item with that id.</p>
    {:else if hits.length === 0}
      <p class="hint">No matches.</p>
    {:else}
      <div class="hits" id="find-hits" role="listbox" aria-label="Matches" {@attach registerList}>
        {#each hits as hit, index (hit.id)}
          <button
            type="button"
            id="find-hit-{hit.id}"
            class={["hit", { active: index === active }]}
            role="option"
            aria-selected={index === active}
            tabindex="-1"
            onclick={() => go(hit)}
          >
            <span class="label">{hit.label}</span>
            {#if hit.path !== ""}<span class="path">{hit.path}</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Overlay>

<style>
  .panel {
    width: 460px;
    max-width: 100%;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    padding: 10px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
    outline: none;
  }

  input {
    width: 100%;
    margin: 0 0 6px;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: color-mix(in srgb, var(--fg) 6%, transparent);
    color: var(--fg);
    font: inherit;
    font-size: 15px;
    outline: none;
  }
  input:focus {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }
  input::placeholder {
    color: var(--muted);
  }

  .hits {
    overflow-y: auto;
  }

  .hit {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .hit:hover,
  .hit.active {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    font-size: 14.5px;
  }

  .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    font-size: 11.5px;
    color: var(--muted);
  }

  .hint {
    margin: 4px 2px 8px;
    font-size: 13.5px;
    color: var(--muted);
  }
</style>
