<script lang="ts">
  import { deriveTags, effectivePriority } from "@kalamu/core";
  import { nodeCommands } from "../lib/cli-commands";
  import { writeClipboard } from "../lib/copy";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { digitPick, filterItems, snapSelection, stepSelection } from "../lib/palette";
  import { blockerCandidates, blockerEntries, candidateLabel, isStarted } from "../lib/task-state";
  import { theme } from "../lib/theme.svelte";
  import Overlay from "./Overlay.svelte";

  interface Props {
    store: OutlineStore;
    onclose: () => void;
    /** Swap the palette for a view sheet — the caller closes the palette. */
    onshowshortcuts: () => void;
    onshowcli: () => void;
  }

  let { store, onclose, onshowshortcuts, onshowcli }: Props = $props();

  type Level = "root" | "priority" | "assign" | "labels" | "cli" | "block" | "unblock";

  const CRUMBS: Record<Exclude<Level, "root">, string> = {
    priority: "Priority",
    assign: "Assign",
    labels: "Labels",
    cli: "Copy CLI",
    block: "Block on",
    unblock: "Unblock",
  };

  /**
   * One row; `stays` keeps the palette open after running (label multi-toggle),
   * `disabled` greys it out — still listed, never selectable or activatable.
   */
  interface Item {
    id: string;
    label: string;
    /** Text the query matches but the row doesn't show — a shortened label's tail. */
    search?: string;
    checked?: boolean;
    stays?: boolean;
    disabled?: boolean;
    run: () => void;
  }

  let level = $state<Level>("root");
  let query = $state("");
  let cursor = $state(0);
  /** Arrow keys were used since the query last changed — Enter then always activates. */
  let navigated = $state(false);
  let input = $state<HTMLInputElement>();

  // The palette steals focus from the editable, so it targets the store's
  // last-focused node; that id may point at a since-deleted node.
  const node = $derived(store.lastFocusedId === null ? undefined : store.tree.byId.get(store.lastFocusedId));

  // Same wording as PriorityMenu, so the two priority surfaces read alike.
  const PRIORITIES = [
    { p: 1, label: "p1 · high" },
    { p: 2, label: "p2 · medium (default)" },
    { p: 3, label: "p3 · low" },
  ] as const;

  const items = $derived.by((): Item[] => {
    const target = node;
    if (level === "priority") {
      if (!target) return [];
      const current = effectivePriority(target);
      return PRIORITIES.map(({ p, label }) => ({
        id: `p${p}`,
        label,
        checked: current === p,
        run: () => {
          store.setPriority(target.id, p);
          close();
        },
      }));
    }
    if (level === "assign") {
      if (!target || target.kind !== "task") return [];
      const task = target;
      // Same wording as AssignMenu, so the two assign surfaces read alike.
      const picks = [
        { id: "assign-human", label: "Human — agents skip the task", value: "human" },
        { id: "assign-agent", label: "Agent", value: "agent" },
        { id: "assign-none", label: "Unassigned", value: null },
      ] as const;
      return picks.map(({ id, label, value }) => ({
        id,
        label,
        checked: (task.assignee ?? null) === value,
        run: () => {
          store.setAssignee(task.id, value);
          close();
        },
      }));
    }
    if (level === "labels") {
      if (!target) return [];
      const present = deriveTags(target.text);
      return store.allTags.map((tag) => ({
        id: `tag-${tag}`,
        label: `#${tag}`,
        checked: present.includes(tag),
        stays: true,
        run: () => store.toggleTag(target.id, tag),
      }));
    }
    if (level === "block") {
      if (!target || target.kind !== "task") return [];
      const task = target;
      // The whole outline is the candidate pool — blockers cross the tree, and
      // zoom/filters are view state (SPEC key decision 16). The palette's own
      // query box does the searching; no separate picker. Open tasks lead the
      // list and every row is shortened (see candidateLabel).
      return blockerCandidates(store.nodes, task).map((candidate) => ({
        id: `block-${candidate.id}`,
        label: candidateLabel(candidate),
        search: candidate.text, // the shortened label must not shrink what the query finds
        run: () => {
          store.addBlocker(task.id, candidate.id);
          close();
        },
      }));
    }
    if (level === "unblock") {
      if (!target) return [];
      const blocked = target;
      const entries = blockerEntries(store.tree, blocked);
      const rows: Item[] = entries.map((entry) => ({
        id: `unblock-${entry.id}`,
        // A done blocker is still recorded, so it is still removable — the
        // suffix says why it isn't holding anything up.
        label: entry.open ? entry.label : `${entry.label} — done`,
        run: () => {
          store.removeBlocker(blocked.id, entry.id);
          close();
        },
      }));
      if (entries.length > 1) {
        rows.push({
          id: "unblock-all",
          label: "Remove all blockers",
          run: () => {
            store.removeBlocker(blocked.id);
            close();
          },
        });
      }
      return rows;
    }
    if (level === "cli") {
      if (!target) return [];
      return nodeCommands({
        serverId: store.serverId(target.id),
        done: target.doneAt !== null,
        hasChildren: (store.tree.children.get(target.id) ?? []).length > 0,
        isTask: target.kind === "task",
        started: target.startedAt !== undefined,
      }).map((command) => ({
        id: `cli-${command.split(" ")[1] ?? command}`, // the subcommand word — unique within this list
        label: command,
        run: () => void copyCommand(command),
      }));
    }
    // Root level: a fixed list with stable numbers (SPEC). Items that don't
    // apply — node actions without a target, Assign on a bullet or a
    // discussion (never assigned — SPEC key decision 12), or Collapse parent
    // with nothing rendered above to fold — are disabled rather than hidden.
    // Priority works on every kind, matching the inline badge: p1/p3 on a
    // bullet converts it to a task (core behavior).
    const task = target?.kind === "task" ? target : undefined;
    const started = task !== undefined && isStarted(task);
    return [
      { id: "priority", label: "Priority…", disabled: !target, run: () => enter("priority") },
      { id: "labels", label: "Labels…", disabled: !target, run: () => enter("labels") },
      { id: "assign", label: "Assign…", disabled: !task, run: () => enter("assign") },
      {
        // Done works on bullets too — visual-only strikethrough (SPEC).
        id: "done",
        label: "Toggle done",
        checked: target !== undefined && target.doneAt !== null,
        disabled: !target,
        run: () => {
          if (!target) return;
          store.toggleDone(target.id);
          close();
        },
      },
      {
        // Claim / release, one slot labelled by state (SPEC key decision 17).
        // A done task keeps its startedAt as a record of how long the work
        // took, so End is never offered there — only Start, disabled.
        id: started ? "end" : "start",
        label: started ? "End — release the claim" : "Start — claim this task",
        disabled: !task || (!started && task.doneAt !== null),
        run: () => {
          if (!task) return;
          if (started) store.endTask(task.id);
          else store.startTask(task.id);
          close();
        },
      },
      {
        // Blockers are tasks-only and cross the tree freely (key decision 16).
        // A second node is all it takes for the submenu to have something to
        // offer, so no candidate list is built just to grey the item out.
        id: "block",
        label: "Block on…",
        disabled: !task || store.nodes.length < 2,
        run: () => enter("block"),
      },
      {
        // Lists what is recorded, done blockers included — they are removable
        // even though they no longer hold anything up.
        id: "unblock",
        label: "Unblock…",
        disabled: !target || (target.blockedBy ?? []).length === 0,
        run: () => enter("unblock"),
      },
      {
        // Structural, so it applies to every kind; inert on root-level nodes
        // and on the zoom root (canCollapseParent mirrors the store's guards).
        id: "collapse-parent",
        label: "Collapse parent",
        disabled: !target || !store.canCollapseParent(target.id),
        run: () => {
          if (!target) return;
          store.collapseParent(target.id);
          // Not close(): its focus restore would put the caret back in the
          // acted-on node — this action must leave it on the PARENT.
          onclose();
        },
      },
      {
        // The inverse: structural too, inert on leaves (canExpandChildren
        // mirrors the store's guard — no zoom guard, expanding descends
        // into the view).
        id: "expand-children",
        label: "Expand children",
        disabled: !target || !store.canExpandChildren(target.id),
        run: () => {
          if (!target) return;
          store.expandChildren(target.id);
          // Not close(): this action must leave the caret on the FIRST CHILD.
          onclose();
        },
      },
      // Copy CLI command works on bullets too — only a target is required.
      { id: "copy-cli", label: "Copy CLI command…", disabled: !target, run: () => enter("cli") },
      {
        // View state, so it needs no target — same family as the theme toggle.
        id: "compact",
        label: store.compact ? "Leave compact mode" : "Enter compact mode",
        run: () => {
          store.toggleCompact();
          close();
        },
      },
      {
        id: "theme",
        label: theme.mode === "dark" ? "Activate light mode" : "Activate dark mode",
        run: () => {
          theme.toggle();
          close();
        },
      },
      {
        id: "clean",
        label: "Clean up",
        run: () => {
          store.clean();
          close();
        },
      },
      // The view sheets always come last (SPEC).
      { id: "view-shortcuts", label: "View keyboard shortcuts", run: onshowshortcuts },
      { id: "view-cli", label: "View CLI commands", run: onshowcli },
    ];
  });

  const filtered = $derived(filterItems(items, query));
  // Filtering can shrink the list under the cursor, and the cursor must never
  // rest on a disabled item; -1 when nothing is selectable.
  const selected = $derived(snapSelection(filtered, cursor));

  function enter(sublevel: Level): void {
    level = sublevel;
    query = "";
    cursor = 0;
    navigated = false;
  }

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

  /** Escape steps back a level; at the root it closes (Overlay owns the keypress). */
  function onescape(): void {
    if (level === "root") close();
    else enter("root");
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
      enter("root");
      input?.focus(); // regaining focus lands inside the overlay, so this can't re-trigger the focus-leave
    }
  }

  function activate(item: Item): void {
    item.run();
    if (item.stays) {
      // Ready for the next toggle: full list again, checkmarks just updated.
      query = "";
      cursor = 0;
      navigated = false;
    }
  }

  function onQueryInput(): void {
    cursor = 0;
    navigated = false;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    // The outline (and App's window handler) must never see palette keys.
    // Escape never reaches here — Overlay intercepts it at the window's
    // capture phase, so it works even when focus has left the panel.
    event.stopPropagation();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = stepSelection(filtered, selected, event.key === "ArrowDown" ? 1 : -1);
      if (next === -1) return;
      navigated = true;
      cursor = next;
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // Labels is a multi-toggle level: Enter on an empty, un-navigated query means "done".
      if (level === "labels" && query === "" && !navigated) {
        close();
        return;
      }
      const item = filtered[selected];
      if (item) activate(item);
      return;
    }
    if (event.key === "Backspace" && query === "") {
      event.preventDefault();
      onescape();
      return;
    }
    // Digits quick-select only while the query is empty; afterwards they type (so
    // "v2" works). A digit on a disabled item is swallowed, not typed.
    if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const action = digitPick(filtered, query, Number(event.key));
      if (action.kind === "type") return;
      event.preventDefault();
      if (action.kind === "activate") activate(action.item);
    }
  }

</script>

<Overlay top="12vh" onclose={close} {onescape} {onfocusleave}>
  <div class="panel" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" {onkeydown}>
    {#if node}
      <div class="context">
        {#if level !== "root"}<span class="crumb">{CRUMBS[level]}</span>{/if}
        <span class="target">{node.text.trim() === "" ? "(empty item)" : node.text}</span>
      </div>
    {/if}
    <input
      type="text"
      bind:value={query}
      oninput={onQueryInput}
      placeholder={level === "root" ? "Type to filter, 1–9 to pick…" : "Type to filter, Backspace for back…"}
      aria-label="Filter commands"
      aria-controls="palette-list"
      aria-activedescendant={filtered[selected] ? `palette-opt-${filtered[selected].id}` : undefined}
      {@attach (element: HTMLInputElement) => {
        input = element; // kept for the focus-leave back-step refocus
        element.focus();
        return () => (input = undefined);
      }}
    />

    {#if !node}
      <p class="hint">Focus an item to use the item actions — the view commands work anywhere.</p>
    {/if}
    {#if level === "labels" && store.allTags.length === 0}
      <p class="hint">No tags yet — type <code>#tag</code> inline in an item's text.</p>
    {:else if filtered.length === 0}
      <p class="hint">No matches.</p>
    {:else}
      <!-- preventDefault keeps focus on the input when items are clicked -->
      <div
        class="items"
        id="palette-list"
        role="listbox"
        aria-label="Commands"
        tabindex="-1"
        onpointerdown={(event) => event.preventDefault()}
      >
        {#each filtered as item, index (item.id)}
          <button
            class={["item", { active: index === selected }]}
            id="palette-opt-{item.id}"
            role="option"
            aria-selected={index === selected}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            tabindex="-1"
            onclick={() => activate(item)}
          >
            <span class="badge">{index < 9 ? index + 1 : ""}</span>
            <span class={["label", { mono: level === "cli" }]}>{item.label}</span>
            {#if item.checked}<span class="tick" aria-hidden="true">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</Overlay>

<style>
  .panel {
    width: 420px;
    max-width: 100%;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    padding: 10px;
    border-radius: 12px;
    background: var(--panel);
    border: 1px solid var(--guide);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  }

  .context {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 2px 8px;
    min-width: 0;
  }

  .crumb {
    flex: none;
    font-size: 10.5px;
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
    font-size: 12px;
    color: var(--muted);
  }

  input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--guide);
    border-radius: 8px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 13.5px;
    outline: none;
  }
  input::placeholder {
    color: var(--muted);
  }

  .items {
    margin-top: 6px;
    overflow-y: auto;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .item:hover:enabled {
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }
  .item.active {
    background: color-mix(in srgb, var(--fg) 9%, transparent);
  }
  .item:disabled {
    color: var(--muted);
    opacity: 0.55;
    cursor: default;
  }

  .badge {
    flex: none;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border: 1px solid var(--guide);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: var(--muted);
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
  }

  .tick {
    flex: none;
    font-size: 11px;
    color: var(--muted);
  }

  .hint {
    margin: 10px 2px 4px;
    font-size: 12.5px;
    color: var(--muted);
  }

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--fg) 7%, transparent);
    border: 1px solid var(--guide);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
</style>
