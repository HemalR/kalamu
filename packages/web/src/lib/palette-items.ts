/**
 * The command palette's rows, level by level (SPEC "Command palette"). Pure
 * apart from the closures each row runs: a level is a function of a
 * PaletteContext, so CommandPalette keeps only keys, focus and rendering, and
 * the rules about what applies when are unit-tested here.
 */
import { deriveTags, effectivePriority, tagColor, type KalamuNode } from "@kalamu/core";
import { nodeCommands } from "./cli-commands";
import { nodeAssignee } from "./filter";
import type { HubProject } from "./hub";
import type { OutlineStore } from "./outline.svelte";
import { assignKeys, LEADER_KEYS as K, sortByKey } from "./palette";
import {
  blockerCandidates,
  blockerEntries,
  candidateLabel,
  isAssignable,
  isBlockable,
  isStarted,
} from "./task-state";
import { ASSIGN_LABELS, PRIORITY_OPTIONS } from "./vocab";

export type Level =
  | "root"
  | "priority"
  | "assign"
  | "labels"
  | "copy"
  | "cli"
  | "kind"
  | "move"
  | "blocking"
  | "block"
  | "unblock"
  | "view"
  | "zoom";

export type Sublevel = Exclude<Level, "root">;

export const CRUMBS: Record<Sublevel, string> = {
  priority: "Priority",
  assign: "Assign",
  labels: "Labels",
  copy: "Copy",
  cli: "CLI command",
  kind: "Kind",
  move: "Move",
  blocking: "Block",
  block: "Add block",
  unblock: "Remove block",
  view: "View",
  zoom: "Zoom",
};

/** Where a level steps back to; CLI and blocker pickers sit two levels deep. */
export const PARENT: Record<Sublevel, Level> = {
  priority: "root",
  assign: "root",
  labels: "root",
  copy: "root",
  cli: "copy",
  kind: "root",
  move: "root",
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
export interface Item {
  id: string;
  key: string | null;
  label: string;
  checked?: boolean;
  stays?: boolean;
  disabled?: boolean;
  /** Hub project and tag rows carry their colour. */
  swatch?: string;
  run: () => void;
}

/** Everything a level reads, and every way a row can leave the palette. */
export interface PaletteContext {
  store: OutlineStore;
  /** The node the item actions act on — the last-focused one, if it still exists. */
  target: KalamuNode | undefined;
  /** Hub projects for the digit rows (empty outside the hub), in registry order. */
  projects: readonly Pick<HubProject, "slug" | "name" | "color">[];
  activeSlug: string;
  theme: { readonly mode: "light" | "dark"; toggle(): void };
  enter: (level: Sublevel) => void;
  /** Close and put the caret back in the target. */
  close: () => void;
  /** Close and leave the caret to the action (zoom, expand and collapse-parent place it). */
  dismiss: () => void;
  copyCommand: (command: string) => void;
  navigate: (href: string) => void;
  show: { shortcuts: () => void; cli: () => void; find: () => void };
}

// Named outright rather than cycled (Alt/Option+Enter), so the target kind is
// one keypress away whatever the node is now.
const KINDS = [
  { key: "b", kind: "bullet", label: "Bullet" },
  { key: "d", kind: "discussion", label: "Discussion" },
  { key: "t", kind: "task", label: "Task" },
] as const;

// Hand-picked mnemonics; the list order is alphabetical by key, like every
// level whose keys are hand-picked.
const ASSIGN_KEYS = { human: "h", agent: "a", unassigned: "u" } as const;

export const LEVELS: Record<Level, (ctx: PaletteContext) => Item[]> = {
  priority: ({ store, target, close }) => {
    if (!target) return [];
    const current = effectivePriority(target);
    return sortByKey(
      PRIORITY_OPTIONS.map(({ value, label }) => ({
        id: `p${value}`,
        key: String(value),
        label,
        checked: current === value,
        run: () => {
          store.setPriority(target.id, value);
          close();
        },
      })),
    );
  },

  assign: ({ store, target, close }) => {
    if (!target || !isAssignable(target)) return [];
    const current = nodeAssignee(target);
    return sortByKey(
      (["human", "agent", "unassigned"] as const).map((value) => ({
        id: `assign-${value === "unassigned" ? "none" : value}`,
        key: ASSIGN_KEYS[value],
        label: ASSIGN_LABELS[value],
        checked: current === value,
        run: () => {
          store.setAssignee(target.id, value === "unassigned" ? null : value);
          close();
        },
      })),
    );
  },

  labels: ({ store, target }) => {
    if (!target) return [];
    const present = deriveTags(target.text);
    const keys = assignKeys(store.allTags.length);
    return store.allTags.map((tag, index) => ({
      id: `tag-${tag}`,
      key: keys[index] ?? null,
      label: `#${tag}`,
      swatch: tagColor(tag, store.meta.tags),
      checked: present.includes(tag),
      stays: true,
      run: () => store.toggleTag(target.id, tag),
    }));
  },

  block: ({ store, target, close }) => {
    if (!target || !isBlockable(target)) return [];
    // The whole outline is the candidate pool — blockers cross the tree, and
    // zoom/filters are view state (SPEC key decision 16). Open tasks lead the
    // list and every row is shortened (see candidateLabel); rows past the key
    // supply stay reachable by click and scroll.
    const candidates = blockerCandidates(store.nodes, target);
    const keys = assignKeys(candidates.length);
    return candidates.map((candidate, index) => ({
      id: `block-${candidate.id}`,
      key: keys[index] ?? null,
      label: candidateLabel(candidate),
      run: () => {
        store.addBlocker(target.id, candidate.id);
        close();
      },
    }));
  },

  unblock: ({ store, target, close }) => {
    if (!target) return [];
    const entries = blockerEntries(store.tree, target);
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
        store.removeBlocker(target.id, entry.id);
        close();
      },
    }));
    if (removeAll) {
      rows.push({
        id: "unblock-all",
        key: "a",
        label: "Remove all blockers",
        run: () => {
          store.removeBlocker(target.id);
          close();
        },
      });
    }
    return rows;
  },

  blocking: ({ store, target, enter, close }) => {
    const blockers = target?.blockedBy ?? [];
    return sortByKey([
      {
        id: "add-block",
        key: K.block.add,
        label: "Add block…",
        disabled: target === undefined || !isBlockable(target) || store.nodes.length < 2,
        run: () => enter("block"),
      },
      {
        id: "remove-block",
        key: K.block.remove,
        // One blocker is a destination, not a choice — same as the badge.
        // The ellipsis stays only when a submenu will open.
        label: blockers.length > 1 ? "Remove block…" : "Remove block",
        disabled: !target || blockers.length === 0,
        run: () => {
          if (!target) return;
          const entries = blockerEntries(store.tree, target);
          const only = entries.length === 1 ? entries[0] : undefined;
          if (only === undefined) return enter("unblock");
          store.removeBlocker(target.id, only.id);
          close();
        },
      },
    ]);
  },

  copy: ({ store, target, enter, close }) => {
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
  },

  kind: ({ store, target, close }) => {
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
  },

  // Structure without a keyboard: the Tab / Shift+Tab / Mod+Arrow moves, for
  // touch screens. Rows stay open so a node can travel several steps; a move
  // that would be inert (no sibling that way, the zoom boundary) is greyed.
  move: ({ store, target }) => {
    if (!target) return [];
    const { id } = target;
    return [
      { id: "move-up", key: "ArrowUp", label: "Move up", disabled: !store.canMoveBySibling(id, -1), stays: true, run: () => store.moveBySibling(id, -1) },
      { id: "move-down", key: "ArrowDown", label: "Move down", disabled: !store.canMoveBySibling(id, 1), stays: true, run: () => store.moveBySibling(id, 1) },
      { id: "indent", key: "ArrowRight", label: "Indent", disabled: !store.canIndent(id), stays: true, run: () => store.indent(id) },
      { id: "outdent", key: "ArrowLeft", label: "Outdent", disabled: !store.canOutdent(id), stays: true, run: () => store.outdent(id) },
    ];
  },

  cli: ({ store, target, copyCommand }) => {
    if (!target) return [];
    const commands = nodeCommands({
      serverId: store.serverId(target.id),
      done: target.doneAt !== null,
      hasChildren: (store.tree.children.get(target.id) ?? []).length > 0,
      claimable: target.kind !== "bullet",
      started: target.startedAt !== undefined,
    });
    const keys = assignKeys(commands.length);
    return commands.map((command, index) => ({
      id: `cli-${command.split(" ")[1] ?? command}`, // the subcommand word — unique within this list
      key: keys[index] ?? null,
      label: command,
      run: () => copyCommand(command),
    }));
  },

  // View state, no target needed — labels reflect what pressing would do.
  view: ({ store, theme, close }) =>
    sortByKey([
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
        id: "theme",
        key: "t",
        label: theme.mode === "dark" ? "Activate light mode" : "Activate dark mode",
        run: () => {
          theme.toggle();
          close();
        },
      },
    ]),

  zoom: ({ store, target, dismiss }) =>
    sortByKey([
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
          dismiss(); // zoom puts the caret in the node it zooms to
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
          dismiss();
        },
      },
    ]),

  // Hub project digits, then the lettered rows alphabetically, then the arrow
  // and punctuation rows — sortByKey imposes that reading order, so rows are
  // declared by affinity instead. Items that don't apply — node actions
  // without a target, Assign on a discussion (never assigned — SPEC key
  // decision 12), or Collapse parent with nothing rendered above to fold — are
  // disabled rather than hidden. Assign and Priority both promote a bullet
  // when given real task metadata.
  root: ({ store, target, projects, activeSlug, enter, close, dismiss, navigate, show }) => {
    // Tasks and discussions can be claimed; bullets carry no state (SPEC key decision 17, amended 2026-09-05).
    const claimable = target !== undefined && target.kind !== "bullet" ? target : undefined;
    const started = claimable !== undefined && isStarted(claimable);
    // Registry order — the same order that numbers the sidebar.
    const projectRows: Item[] = projects.map((project, index) => ({
      id: `project-${project.slug}`,
      key: String(index + 1),
      label: project.name,
      swatch: project.color,
      checked: project.slug === activeSlug,
      // Plain navigation on purpose: each project is a fresh app instance.
      run: () => (project.slug === activeSlug ? close() : navigate(`/p/${project.slug}`)),
    }));
    /** A row that acts on the target, then closes. */
    const onTarget = (action: (node: KalamuNode) => void, after: () => void = close) => () => {
      if (!target) return;
      action(target);
      after();
    };
    /** A row that acts without a target, then closes. */
    const then = (action: () => void) => () => {
      action();
      close();
    };
    return sortByKey([
      ...projectRows,
      // Done works on bullets too — visual-only strikethrough (SPEC).
      {
        id: "done",
        key: "d",
        label: "Toggle done",
        checked: target !== undefined && target.doneAt !== null,
        disabled: !target,
        run: onTarget((node) => store.toggleDone(node.id)),
      },
      { id: "priority", key: "p", label: "Priority…", disabled: !target, run: () => enter("priority") },
      {
        id: "assign",
        key: "a",
        label: "Assign…",
        disabled: target === undefined || !isAssignable(target),
        run: () => enter("assign"),
      },
      { id: "labels", key: "l", label: "Labels…", disabled: !target, run: () => enter("labels") },
      { id: "move", key: "m", label: "Move…", disabled: !target, run: () => enter("move") },
      { id: "kind", key: "t", label: "Kind…", disabled: !target, run: () => enter("kind") },
      {
        // Claim / release, one slot labelled by state (SPEC key decision 17).
        // A done item keeps its startedAt as a record of how long the work
        // took, so End is never offered there — only Start, disabled.
        id: started ? "end" : "start",
        key: "s",
        label: started ? "End — release the claim" : "Start — claim this item",
        disabled: !claimable || (!started && claimable.doneAt !== null),
        run: onTarget((node) => (started ? store.endTask(node.id) : store.startTask(node.id))),
      },
      {
        // Tasks and discussions can be blocked (bullets cannot). The submenu
        // groups adding and removing blocker edges under one mnemonic.
        id: "blocking",
        key: K.root.block,
        label: "Block…",
        disabled: target === undefined || !isBlockable(target),
        run: () => enter("blocking"),
      },
      // Copying works on bullets too — only a target is required.
      { id: "copy", key: "c", label: "Copy…", disabled: !target, run: () => enter("copy") },
      { id: "find", key: K.root.find, label: "Find…", run: show.find },
      // Document-wide, so no target is needed; the stacks say when there is
      // nothing left to walk back (or forward) through.
      { id: "undo", key: K.root.undo, label: "Undo", disabled: !store.canUndo, run: then(() => store.undo()) },
      { id: "redo", key: K.root.redo, label: "Redo", disabled: !store.canRedo, run: then(() => store.redo()) },
      {
        // View-wide, so no target is needed. The label is the action: enable
        // when off, disable when on.
        id: "overview",
        key: K.root.overview,
        label: store.overview ? "Overview disabled" : "Overview enabled",
        run: then(() => store.toggleOverview()),
      },
      { id: "view", key: "v", label: "View…", run: () => enter("view") },
      { id: "zoom", key: K.root.zoom, label: "Zoom…", run: () => enter("zoom") },
      { id: "clean", key: "x", label: "Clean up", run: then(() => store.clean()) },
      // The two view sheets (SPEC): each swaps the palette for a full-screen read.
      { id: "view-shortcuts", key: "k", label: "Keyboard cheat sheet", run: show.shortcuts },
      { id: "view-cli", key: "i", label: "CLI reference", run: show.cli },
      // The movement rows, declared in the order sortByKey keeps them in.
      {
        // Structural, so it applies to every kind; inert on leaves and on an
        // already-folded node (Mod+. keeps the toggle for both directions).
        // The caret belongs where it was: this folds beneath it.
        id: "collapse-children",
        key: "ArrowLeft",
        label: "Collapse children",
        disabled: !target || !store.canCollapseChildren(target.id),
        run: onTarget((node) => store.collapseChildren(node.id)),
      },
      {
        // The inverse, and a descent: inert on leaves (canExpandChildren mirrors
        // the store's guard — no zoom guard, expanding descends into the view).
        // The caret must land on the FIRST CHILD, so no focus restore.
        id: "expand-children",
        key: "ArrowRight",
        label: "Expand children",
        disabled: !target || !store.canExpandChildren(target.id),
        run: onTarget((node) => store.expandChildren(node.id), dismiss),
      },
      {
        // Inert on root-level nodes and on the zoom root (canCollapseParent
        // mirrors the store's guards). The caret must land on the PARENT.
        id: "collapse-parent",
        key: "ArrowUp",
        label: "Collapse parent",
        disabled: !target || !store.canCollapseParent(target.id),
        run: onTarget((node) => store.collapseParent(node.id), dismiss),
      },
    ]);
  },
};
