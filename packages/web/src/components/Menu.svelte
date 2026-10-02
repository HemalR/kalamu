<!--
  The one dropdown list: the row's priority/assign/blocker menus (role "menu")
  and the editor's caret combobox (role "listbox"). Anchored below its
  positioned parent — above it when the viewport has no room below (see
  lib/popover.ts's keepInView); the owner decides when it is open and closes
  it (dismissable, same file).

  A menu takes focus on open — the current choice, else the first row — and
  hands it back on close; arrows, Home and End move between rows, Enter picks.
  A listbox never takes focus: the editor keeps the caret and drives
  `highlighted` itself, pointing aria-activedescendant at the `${id}-${index}`
  option ids.
-->
<script lang="ts" generics="T">
  import type { Snippet } from "svelte";
  import { keepInView, takeFocus } from "../lib/popover";

  interface Props {
    options: readonly T[];
    /** Accessible name for the list. */
    label: string;
    /** The list's id, and the prefix of its option ids — for an owner's aria-controls / aria-activedescendant. */
    id?: string;
    role?: "menu" | "listbox";
    /** Which rows hold the current value: ticked, and a menu's rows become radio items. */
    checked?: (option: T) => boolean;
    /** Listbox only: the row the editor's arrow keys point at. */
    highlighted?: number;
    onpick: (option: T) => void;
    /** Row content for one option. */
    item: Snippet<[T]>;
  }

  let { options, label, id, role = "menu", checked, highlighted, onpick, item }: Props = $props();

  const rowRole = $derived(role === "listbox" ? "option" : checked === undefined ? "menuitem" : "menuitemradio");

  function onkeydown(event: KeyboardEvent & { currentTarget: HTMLElement }): void {
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[role^=menuitem]")];
    const at = rows.findIndex((row) => row === document.activeElement);
    const next =
      event.key === "ArrowDown" ? (at + 1) % rows.length
      : event.key === "ArrowUp" ? (at - 1 + rows.length) % rows.length
      : event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    rows[next]?.focus();
  }
</script>

<!-- pointerdown preventDefault: clicking a row must not move focus first (a
     listbox's editor keeps its caret; a menu keeps its focused row) -->
<div
  class="menu"
  {id}
  {role}
  aria-label={label}
  tabindex="-1"
  onpointerdown={(event) => event.preventDefault()}
  onkeydown={role === "menu" ? onkeydown : undefined}
  {@attach role === "menu" &&
    takeFocus((menu) => menu.querySelector<HTMLElement>("[aria-checked=true]") ?? menu.querySelector("button"))}
  {@attach keepInView}
>
  {#each options as option, index (option)}
    {@const ticked = checked?.(option) ?? false}
    <button
      id={id === undefined ? undefined : `${id}-${index}`}
      class={["item", { active: index === highlighted }]}
      role={rowRole}
      aria-checked={rowRole === "menuitemradio" ? ticked : undefined}
      aria-selected={role === "listbox" ? index === highlighted : undefined}
      tabindex="-1"
      onclick={() => onpick(option)}
    >
      {@render item(option)}
      {#if ticked}<span class="tick" aria-hidden="true">✓</span>{/if}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: absolute;
    top: calc(100% + 5px);
    left: 0;
    z-index: var(--z-menu);
    min-width: 168px;
    max-height: 240px;
    overflow-y: auto;
    padding: 4px;
    border-radius: 8px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: var(--menu-shadow);
  }
  .menu:focus {
    outline: none;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 4px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  /* Touch: rows tall enough to hit (≥32px). */
  @media (pointer: coarse) {
    .item {
      padding-block: 9px;
    }
  }
  .item:hover,
  .item:focus-visible,
  .item.active {
    background: var(--hover-tint);
    outline: none;
  }

  .tick {
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
  }
</style>
