<script lang="ts">
  import { apiBase } from "../lib/api";
  import { writeClipboard } from "../lib/copy";
  import { fetchProjects, type HubProject } from "../lib/hub";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { keyBadge } from "../lib/palette";
  import { CRUMBS, LEVELS, PARENT, type Level, type PaletteContext } from "../lib/palette-items";
  import { scrollFade } from "../lib/popover";
  import { theme } from "../lib/theme.svelte";
  import Overlay from "./Overlay.svelte";

  interface Props {
    store: OutlineStore;
    onclose: () => void;
    /** Swap the palette for a view sheet — the caller closes the palette. */
    onshowshortcuts: () => void;
    onshowcli: () => void;
    onshowfind: () => void;
  }

  let { store, onclose, onshowshortcuts, onshowcli, onshowfind }: Props = $props();

  let level = $state<Level>("root");
  let panel = $state<HTMLDivElement>();

  // The palette steals focus from the editable, so it targets the store's
  // last-focused node; that id may point at a since-deleted node.
  const node = $derived(store.lastFocusedId === null ? undefined : store.tree.byId.get(store.lastFocusedId));

  /** The whole path down to the current level, so "Copy › CLI command" shows both. */
  const trail = $derived.by((): string[] => {
    const crumbs: string[] = [];
    let step: Level = level;
    while (step !== "root") {
      crumbs.unshift(CRUMBS[step]);
      step = PARENT[step];
    }
    return crumbs;
  });

  /** Hub mode only; empty until the list loads (quiet on failure — the lettered menu stands alone). */
  let projects = $state.raw<HubProject[]>([]);
  if (apiBase !== "") {
    // Digits 1-9 are the whole supply.
    void fetchProjects().then((list) => (projects = list?.slice(0, 9) ?? []));
  }

  const items = $derived(
    LEVELS[level]({
      store,
      target: node,
      projects,
      activeSlug: apiBase.slice("/p/".length),
      theme,
      enter: (sublevel) => (level = sublevel),
      close,
      dismiss: onclose,
      copyCommand: (command) => void copyCommand(command),
      navigate: (href) => (location.href = href),
      show: { shortcuts: onshowshortcuts, cli: onshowcli, find: onshowfind },
    } satisfies PaletteContext),
  );

  /**
   * Long lists of short rows (the root level, most label sets) take two
   * columns where the screen is wide enough (CSS decides that), so the whole
   * menu fits a laptop screen without scrolling. Long rows — block
   * candidates, CLI commands — keep one column rather than truncate.
   */
  const twoColumns = $derived(items.length > 12 && items.every((item) => item.label.length <= 30));

  /** Close and put the caret back in the target node's editor (if it survives). */
  function close(): void {
    onclose();
    if (node) void store.focus(node.id, "end");
  }

  async function copyCommand(command: string): Promise<void> {
    try {
      await writeClipboard(command);
    } catch {
      store.showToast("could not access the clipboard");
      return; // stay open so the user can retry
    }
    store.showToast(`Copied: ${command}`);
    close();
  }

  /** Escape steps back ONE level; at the root it closes (Overlay owns the keypress). */
  function onescape(): void {
    if (level === "root") close();
    else level = PARENT[level];
  }

  /**
   * Focus left the overlay. When something outside deliberately took focus,
   * don't fight it. A blur to nowhere is almost certainly an Esc eaten by an
   * extension that blurs inputs (e.g. Vimium) — or a stray Tab — so mirror
   * Escape: step back and refocus at a sublevel, close at the root. Esc then
   * behaves identically with or without such an extension.
   */
  function onfocusleave(movedTo: Element | null): void {
    if (movedTo !== null) {
      onclose();
      return;
    }
    if (level === "root") {
      close();
    } else {
      level = PARENT[level];
      panel?.focus(); // regaining focus lands inside the overlay, so this can't re-trigger the focus-leave
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // The outline (and App's window handler) must never see palette keys.
    // Escape never reaches here — Overlay intercepts it at the window's
    // capture phase, so it works even when focus has left the panel.
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // No query to erase anymore, so Backspace mirrors Escape (SPEC).
    if (event.key === "Backspace") {
      event.preventDefault();
      onescape();
      return;
    }
    // A printed key acts immediately; on a disabled row it is swallowed.
    const item = items.find((candidate) => candidate.key === event.key);
    if (item === undefined) return;
    event.preventDefault();
    if (!item.disabled) item.run();
  }
</script>

<Overlay top="12vh" onclose={close} {onescape} {onfocusleave}>
  <!-- No input to focus, so the panel itself takes focus: keys land here and
       the Overlay's focus-leave logic keeps working. -->
  <div
    class="panel"
    role="dialog"
    aria-modal="true"
    aria-label="Command palette"
    tabindex="-1"
    {onkeydown}
    {@attach (element: HTMLDivElement) => {
      panel = element; // kept for the focus-leave back-step refocus
      element.focus();
      return () => (panel = undefined);
    }}
  >
    {#if (node !== undefined && node.text.trim() !== "") || level !== "root"}
      <div class="context">
        {#each trail as crumb (crumb)}<span class="crumb">{crumb}</span>{/each}
        {#if node && node.text.trim() !== ""}<span class="target">{node.text}</span>{/if}
      </div>
    {/if}

    {#if !node && level === "root"}
      <p class="hint">Focus an item to use the item actions — find, view, undo and zoom out work anywhere.</p>
    {/if}
    {#if level === "labels" && store.allTags.length === 0}
      <p class="hint">No tags yet — type <code>#tag</code> inline in an item's text.</p>
    {:else if items.length === 0}
      <p class="hint">Nothing to list.</p>
    {:else}
      <!-- preventDefault keeps focus on the panel when items are clicked -->
      <div
        class="items"
        role="menu"
        aria-label="Commands"
        tabindex="-1"
        onpointerdown={(event) => event.preventDefault()}
        {@attach scrollFade}
      >
        <div class={["grid", { two: twoColumns }]}>
          {#each items as item (item.id)}
            <button
              class="item"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              aria-disabled={item.disabled || undefined}
              disabled={item.disabled}
              tabindex="-1"
              onclick={() => item.run()}
            >
              <span class={["badge", { blank: item.key === null }]} aria-hidden="true">{item.key === null ? "" : keyBadge(item.key)}</span>
              {#if item.swatch !== undefined}<span class="swatch" style:background={item.swatch} aria-hidden="true"></span>{/if}
              <span class={["label", { mono: level === "cli" }]}>{item.label}</span>
              {#if item.checked}<span class="tick" aria-hidden="true">✓</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</Overlay>

<style>
  .panel {
    width: 460px;
    max-width: 100%;
    max-height: calc(100dvh - var(--overlay-top) - 16px);
    display: flex;
    flex-direction: column;
    padding: 10px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: var(--dialog-shadow);
    outline: none;
  }

  .context {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 2px 6px;
    min-width: 0;
  }

  .crumb {
    flex: none;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1;
    padding: 3px 7px;
    border-radius: 999px;
    color: var(--fg);
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }

  .target {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--muted);
  }

  /* The scroller; .grid inside it holds the rows, so two columns grow
     downward instead of spilling sideways out of a height-capped box. */
  .items {
    min-height: 0;
    overflow-y: auto;
  }

  /* Column-first, so the key order still reads top to bottom.
     (Literal breakpoint: see lib/breakpoints.ts.) */
  @media (min-width: 640px) {
    .panel:has(.grid.two) {
      width: 600px;
    }
    .grid.two {
      columns: 2;
      column-gap: 6px;
    }
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    break-inside: avoid;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .item:hover:enabled {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }
  .item:disabled {
    color: var(--muted);
    opacity: 0.55;
    cursor: default;
  }

  .badge {
    flex: none;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border: 1px solid var(--guide);
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--muted);
  }
  /* Rows past the key supply keep the column, not the box. */
  .badge.blank {
    visibility: hidden;
  }

  .swatch {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label.mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .tick {
    flex: none;
    font-size: 12px;
    color: var(--muted);
  }

  .hint {
    margin: 4px 2px 8px;
    font-size: 13.5px;
    color: var(--muted);
  }

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border: 1px solid var(--guide);
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
