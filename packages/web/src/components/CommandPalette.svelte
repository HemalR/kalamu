<script lang="ts">
  import { deriveTags, effectivePriority } from "@kalamu/core";
  import { apiBase } from "../lib/api";
  import { nodeCommands } from "../lib/cli-commands";
  import { writeClipboard } from "../lib/copy";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { assignKeys, keyBadge, LEADER_KEYS as K, sortByKey } from "../lib/palette";
  import {
    blockerCandidates,
    blockerEntries,
    candidateLabel,
    isAssignable,
    isBlockable,
    isStarted,
  } from "../lib/task-state";
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

  type Level =
    | "root"
    | "priority"
    | "assign"
    | "labels"
    | "copy"
    | "cli"
    | "kind"
    | "blocking"
    | "block"
    | "unblock"
    | "view"
    | "zoom";

  const CRUMBS: Record<Exclude<Level, "root">, string> = {
    priority: "Priority",
    assign: "Assign",
    labels: "Labels",
    copy: "Copy",
    cli: "CLI command",
    kind: "Kind",
    blocking: "Block",
    block: "Add block",
    unblock: "Remove block",
    view: "View",
    zoom: "Zoom",
  };

  /** Where a level steps back to; CLI and blocker pickers sit two levels deep. */
  const PARENT: Record<Exclude<Level, "root">, Level> = {
    priority: "root",
    assign: "root",
    labels: "root",
    copy: "root",
    cli: "copy",
    kind: "root",
    blocking: "root",
    block: "blocking",
    unblock: "blocking",
    view: "root",
    zoom: "root",
  };

  /**
   * One row of the leader-key menu. `key` is the single key that triggers it —
   * null past the auto-assign supply (the row stays clickable). `stays` keeps
   * the palette open after running (label multi-toggle), `disabled` greys the
   * row out — still listed, never activatable.
   */
  interface Item {
    id: string;
    key: string | null;
    label: string;
    checked?: boolean;
    stays?: boolean;
    disabled?: boolean;
    /** Hub project rows carry the project's colour. */
    swatch?: string;
    run: () => void;
  }

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

  // ---- hub project rows -------------------------------------------------------

  /** The slice of the hub registry the digit rows need (see Sidebar). */
  interface HubProject {
    slug: string;
    name: string;
    color: string;
  }

  const activeSlug = apiBase.slice("/p/".length);

  /** Hub mode only; empty until the list loads (quiet on failure, like Sidebar). */
  let projects = $state<HubProject[]>([]);

  async function loadProjects(): Promise<void> {
    try {
      // Hub-global endpoint — deliberately NOT prefixed with apiBase.
      const response = await fetch("/api/projects");
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (body !== null && typeof body === "object" && "projects" in body && Array.isArray(body.projects)) {
        projects = (body.projects as HubProject[]).slice(0, 9); // digits 1-9 are the whole supply
      }
    } catch {
      // No sidebar list, no digit rows — the lettered menu stands alone.
    }
  }
  if (apiBase !== "") void loadProjects();

  // Same wording as PriorityMenu, so the two priority surfaces read alike.
  const PRIORITIES = [
    { p: 1, label: "p1 · high" },
    { p: 2, label: "p2 · medium (default)" },
    { p: 3, label: "p3 · low" },
  ] as const;

  // Named outright rather than cycled (Alt/Option+Enter), so the target kind is
  // one keypress away whatever the node is now.
  const KINDS = [
    { key: "b", kind: "bullet", label: "Bullet" },
    { key: "d", kind: "discussion", label: "Discussion" },
    { key: "t", kind: "task", label: "Task" },
  ] as const;

  const items = $derived.by((): Item[] => {
    const target = node;
    if (level === "priority") {
      if (!target) return [];
      const current = effectivePriority(target);
      return sortByKey(
        PRIORITIES.map(({ p, label }) => ({
          id: `p${p}`,
          key: String(p),
          label,
          checked: current === p,
          run: () => {
            store.setPriority(target.id, p);
            close();
          },
        })),
      );
    }
    if (level === "assign") {
      if (!target || !isAssignable(target)) return [];
      const assignable = target;
      // Wording shared with AssignMenu, so the two assign surfaces read alike;
      // the order is this menu's own — alphabetical by key, like every level
      // whose keys are hand-picked.
      const picks = [
        { id: "assign-human", key: "h", label: "Human — agents skip the task", value: "human" },
        { id: "assign-agent", key: "a", label: "Agent", value: "agent" },
        { id: "assign-none", key: "u", label: "Unassigned", value: null },
      ] as const;
      return sortByKey(
        picks.map(({ id, key, label, value }) => ({
          id,
          key,
          label,
          checked: (assignable.assignee ?? null) === value,
          run: () => {
            store.setAssignee(assignable.id, value);
            close();
          },
        })),
      );
    }
    if (level === "labels") {
      if (!target) return [];
      const present = deriveTags(target.text);
      const keys = assignKeys(store.allTags.length);
      return store.allTags.map((tag, index) => ({
        id: `tag-${tag}`,
        key: keys[index] ?? null,
        label: `#${tag}`,
        checked: present.includes(tag),
        stays: true,
        run: () => store.toggleTag(target.id, tag),
      }));
    }
    if (level === "block") {
      if (!target || !isBlockable(target)) return [];
      const blocked = target;
      // The whole outline is the candidate pool — blockers cross the tree, and
      // zoom/filters are view state (SPEC key decision 16). Open tasks lead the
      // list and every row is shortened (see candidateLabel); rows past the key
      // supply stay reachable by click and scroll.
      const candidates = blockerCandidates(store.nodes, blocked);
      const keys = assignKeys(candidates.length);
      return candidates.map((candidate, index) => ({
        id: `block-${candidate.id}`,
        key: keys[index] ?? null,
        label: candidateLabel(candidate),
        run: () => {
          store.addBlocker(blocked.id, candidate.id);
          close();
        },
      }));
    }
    if (level === "unblock") {
      if (!target) return [];
      const blocked = target;
      const entries = blockerEntries(store.tree, blocked);
      // "Remove all blockers" appears with more than one blocker, on `a` — the
      // one key this level reserves out of the auto-assign sequence.
      const removeAll = entries.length > 1;
      const keys = assignKeys(entries.length, removeAll ? new Set(["a"]) : undefined);
      const rows: Item[] = entries.map((entry, index) => ({
        id: `unblock-${entry.id}`,
        key: keys[index] ?? null,
        // A done blocker is still recorded, so it is still removable — the
        // suffix says why it isn't holding anything up.
        label: entry.open ? entry.label : `${entry.label} — done`,
        run: () => {
          store.removeBlocker(blocked.id, entry.id);
          close();
        },
      }));
      if (removeAll) {
        rows.push({
          id: "unblock-all",
          key: "a",
          label: "Remove all blockers",
          run: () => {
            store.removeBlocker(blocked.id);
            close();
          },
        });
      }
      return rows;
    }
    if (level === "blocking") {
      const blockable = target !== undefined && isBlockable(target);
      return sortByKey([
        {
          id: "add-block",
          key: K.block.add,
          label: "Add block…",
          disabled: !blockable || store.nodes.length < 2,
          run: () => enter("block"),
        },
        {
          id: "remove-block",
          key: K.block.remove,
          // One blocker is a destination, not a choice — same as the badge.
          // The ellipsis stays only when a submenu will open.
          label: (target?.blockedBy ?? []).length > 1 ? "Remove block…" : "Remove block",
          disabled: !target || (target.blockedBy ?? []).length === 0,
          run: () => {
            if (!target) return;
            const entries = blockerEntries(store.tree, target);
            const only = entries.length === 1 ? entries[0] : undefined;
            if (only !== undefined) {
              store.removeBlocker(target.id, only.id);
              close();
            } else {
              enter("unblock");
            }
          },
        },
      ]);
    }
    if (level === "copy") {
      if (!target) return [];
      return sortByKey([
        { id: "copy-cli", key: "c", label: "CLI command…", run: () => enter("cli") },
        {
          // The subtree with its ancestor path — what an agent needs to pick the work up.
          id: "copy-prompt",
          key: "p",
          label: "Prompt — item context for an agent chat",
          run: () => {
            store.copyNodeContext(target.id);
            close();
          },
        },
        {
          id: "copy-text",
          key: "t",
          label: "Text — the item's text only",
          run: () => {
            store.copyNodeText(target.id);
            close();
          },
        },
      ]);
    }
    if (level === "kind") {
      if (!target) return [];
      return sortByKey(
        KINDS.map(({ key, kind, label }) => ({
          id: `kind-${kind}`,
          key,
          label,
          checked: target.kind === kind,
          run: () => {
            store.setKind(target.id, kind);
            close();
          },
        })),
      );
    }
    if (level === "cli") {
      if (!target) return [];
      const commands = nodeCommands({
        serverId: store.serverId(target.id),
        done: target.doneAt !== null,
        hasChildren: (store.tree.children.get(target.id) ?? []).length > 0,
        isTask: target.kind === "task",
        started: target.startedAt !== undefined,
      });
      const keys = assignKeys(commands.length);
      return commands.map((command, index) => ({
        id: `cli-${command.split(" ")[1] ?? command}`, // the subcommand word — unique within this list
        key: keys[index] ?? null,
        label: command,
        run: () => void copyCommand(command),
      }));
    }
    if (level === "view") {
      // View state, no target needed — labels reflect what pressing would do.
      return sortByKey([
        {
          id: "hide-done",
          key: "h",
          label: store.hideDone ? "Show done items" : "Hide done items",
          run: () => {
            store.toggleHideDone();
            close();
          },
        },
        {
          id: "compact",
          key: "m",
          label: store.compact ? "Leave compact mode" : "Enter compact mode",
          run: () => {
            store.toggleCompact();
            close();
          },
        },
        {
          id: "theme",
          key: "t",
          label: theme.mode === "dark" ? "Activate light mode" : "Activate dark mode",
          run: () => {
            theme.toggle();
            close();
          },
        },
      ]);
    }
    if (level === "zoom") {
      return sortByKey([
        {
          // Already zoomed here is the one no-op worth greying — re-zooming
          // would look like nothing happened.
          id: "zoom-in",
          key: K.zoom.in,
          label: "Zoom in",
          disabled: !target || store.zoomId === target.id,
          run: () => {
            if (!target) return;
            store.zoomIn(target.id);
            // Not close(): zoom puts the caret in the node it zooms to.
            onclose();
          },
        },
        {
          // Acts on the zoom root, so it needs no target — only a zoom to leave.
          id: "zoom-out",
          key: K.zoom.out,
          label: "Zoom out",
          disabled: store.zoomNode === null,
          run: () => {
            store.zoomOut();
            onclose();
          },
        },
      ]);
    }
    // Root level: hub project digits, then the lettered rows alphabetically,
    // then the arrow and punctuation rows — sortByKey imposes that reading
    // order, so rows are declared by affinity instead. Items that don't apply —
    // node actions without a target, Assign on a discussion (never assigned —
    // SPEC key decision 12), or Collapse parent with nothing rendered above to
    // fold — are disabled rather than hidden. Assign and Priority both promote
    // a bullet when given real task metadata.
    const assignable = target !== undefined && isAssignable(target);
    const task = target?.kind === "task" ? target : undefined;
    const started = task !== undefined && isStarted(task);
    // Blocking is the one node action that covers discussions as well as tasks.
    const blockable = target !== undefined && isBlockable(target);
    // Registry order — the same order that numbers the sidebar.
    const projectRows: Item[] = projects.map((project, index) => ({
      id: `project-${project.slug}`,
      key: String(index + 1),
      label: project.name,
      swatch: project.color,
      checked: project.slug === activeSlug,
      run: () => {
        // Plain navigation on purpose: each project is a fresh app instance.
        if (project.slug === activeSlug) close();
        else location.href = `/p/${project.slug}`;
      },
    }));
    return sortByKey([
      ...projectRows,
      {
        // Done works on bullets too — visual-only strikethrough (SPEC).
        id: "done",
        key: "d",
        label: "Toggle done",
        checked: target !== undefined && target.doneAt !== null,
        disabled: !target,
        run: () => {
          if (!target) return;
          store.toggleDone(target.id);
          close();
        },
      },
      { id: "priority", key: "p", label: "Priority…", disabled: !target, run: () => enter("priority") },
      { id: "assign", key: "a", label: "Assign…", disabled: !assignable, run: () => enter("assign") },
      { id: "labels", key: "l", label: "Labels…", disabled: !target, run: () => enter("labels") },
      { id: "kind", key: "t", label: "Kind…", disabled: !target, run: () => enter("kind") },
      {
        // Claim / release, one slot labelled by state (SPEC key decision 17).
        // A done task keeps its startedAt as a record of how long the work
        // took, so End is never offered there — only Start, disabled.
        id: started ? "end" : "start",
        key: "s",
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
        // Tasks and discussions can be blocked (bullets cannot). The submenu
        // groups adding and removing blocker edges under one mnemonic.
        id: "blocking",
        key: K.root.block,
        label: "Block…",
        disabled: !blockable,
        run: () => enter("blocking"),
      },
      // Copying works on bullets too — only a target is required.
      { id: "copy", key: "c", label: "Copy…", disabled: !target, run: () => enter("copy") },
      {
        // Document-wide, so no target is needed; the stacks say when there is
        // nothing left to walk back (or forward) through.
        id: "undo",
        key: K.root.undo,
        label: "Undo",
        disabled: !store.canUndo,
        run: () => {
          store.undo();
          close();
        },
      },
      {
        id: "redo",
        key: K.root.redo,
        label: "Redo",
        disabled: !store.canRedo,
        run: () => {
          store.redo();
          close();
        },
      },
      { id: "view", key: "v", label: "View…", run: () => enter("view") },
      { id: "zoom", key: K.root.zoom, label: "Zoom…", run: () => enter("zoom") },
      {
        id: "clean",
        key: "x",
        label: "Clean up",
        run: () => {
          store.clean();
          close();
        },
      },
      // The two view sheets (SPEC): each swaps the palette for a full-screen read.
      { id: "view-shortcuts", key: "k", label: "Keyboard cheat sheet", run: onshowshortcuts },
      { id: "view-cli", key: "i", label: "CLI reference", run: onshowcli },
      // The movement rows, declared in the order sortByKey keeps them in.
      {
        // Structural, so it applies to every kind; inert on leaves and on an
        // already-folded node (Mod+. keeps the toggle for both directions).
        id: "collapse-children",
        key: "ArrowLeft",
        label: "Collapse children",
        disabled: !target || !store.canCollapseChildren(target.id),
        run: () => {
          if (!target) return;
          store.collapseChildren(target.id);
          close(); // the caret belongs where it was: this folds beneath it
        },
      },
      {
        // The inverse, and a descent: inert on leaves (canExpandChildren mirrors
        // the store's guard — no zoom guard, expanding descends into the view).
        id: "expand-children",
        key: "ArrowRight",
        label: "Expand children",
        disabled: !target || !store.canExpandChildren(target.id),
        run: () => {
          if (!target) return;
          store.expandChildren(target.id);
          // Not close(): this action must leave the caret on the FIRST CHILD.
          onclose();
        },
      },
      {
        // Inert on root-level nodes and on the zoom root (canCollapseParent
        // mirrors the store's guards).
        id: "collapse-parent",
        key: "ArrowUp",
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
    ]);
  });

  function enter(sublevel: Level): void {
    level = sublevel;
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

  /** Escape steps back ONE level; at the root it closes (Overlay owns the keypress). */
  function onescape(): void {
    if (level === "root") close();
    else enter(PARENT[level]);
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
      enter(PARENT[level]);
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
      <p class="hint">Focus an item to use the item actions — view, undo and zoom out work anywhere.</p>
    {/if}
    {#if level === "labels" && store.allTags.length === 0}
      <p class="hint">No tags yet — type <code>#tag</code> inline in an item's text.</p>
    {:else if items.length === 0}
      <p class="hint">Nothing to list.</p>
    {:else}
      <!-- preventDefault keeps focus on the panel when items are clicked -->
      <div class="items" role="menu" aria-label="Commands" tabindex="-1" onpointerdown={(event) => event.preventDefault()}>
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

  .items {
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
    font-size: 14.5px;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
  }
</style>
