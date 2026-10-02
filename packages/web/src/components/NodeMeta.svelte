<!--
  The meta row under a node, above its children, carrying whatever the node
  has to say about itself: progress, Blocked, assignment, age. Rendered for
  every node whatever the state of the outline: furniture that appeared on
  hover would shove the hovered row out from under the pointer and oscillate.
  Only the bar and the caption come and go, and the row's fixed height keeps
  even that free of reflow. The one exception is Overview mode, whose job is
  a shorter page: there a row with nothing but its age is hidden — a
  per-mode constant, never a hover effect. It is also the node's accessible
  description (OutlineNode points the text at `id`), so it starts with the
  state a sighted reader gets from the glyph: done, in progress, collapsed.
  Blocked and assignment are the interactive items; both keep tabindex="-1"
  like the row's other furniture, so click-to-edit and caret navigation still
  step straight past this row.
-->
<script lang="ts">
  import { formatRelativeTime, type KalamuNode } from "@kalamu/core";
  import type { Snippet } from "svelte";
  import { ASSIGNEE_VALUES, nodeAssignee } from "../lib/filter";
  import { now } from "../lib/now.svelte";
  import type { OutlineStore } from "../lib/outline.svelte";
  import { dismissable } from "../lib/popover";
  import { blockedTitle, candidateLabel, isStarted, openBlockers } from "../lib/task-state";
  import { ASSIGN_LABELS } from "../lib/vocab";
  import AssigneeIcon from "./AssigneeIcon.svelte";
  import Menu from "./Menu.svelte";
  import ProgressBar from "./ProgressBar.svelte";

  interface Props {
    node: KalamuNode;
    store: OutlineStore;
    id: string;
    /** Row buttons rendered at the right end (phones put copy/delete here). */
    actions?: Snippet;
  }

  let { node, store, id, actions }: Props = $props();

  // Counts come from the store's single derived pass and describe the REAL
  // tree, so a filter or hide-done never rewrites them (see @kalamu/core's
  // progress.ts). One actionable descendant is enough for a bar.
  const progress = $derived(store.progress.get(node.id) ?? { total: 0, done: 0, active: 0 });

  // Only OPEN blockers hold a node up — a fully-done blocker list looks normal
  // (SPEC key decision 16). Tasks and discussions can both be blocked, so the
  // badge is not kind-gated.
  const blockers = $derived(openBlockers(store.tree, node));

  /* Off the app's shared clock, not `new Date()`: a derived that closed over
     the current time would never re-run, so a row would still read "now" hours
     later in a window nobody reloads. */
  const createdAgo = $derived(formatRelativeTime(node.createdAt, { now: now.current }));
  const createdTitle = $derived(`Created ${new Date(node.createdAt).toLocaleString()}`);

  /** Overview hides a row that would only say how old the node is. */
  const quiet = $derived(
    store.overview && progress.total === 0 && blockers.length === 0 && node.assignee === undefined && actions === undefined,
  );

  const hiddenChildren = $derived(store.collapsed.has(node.id) ? (store.tree.children.get(node.id)?.length ?? 0) : 0);
  /** For screen readers only: what the glyph and its ring show. */
  const status = $derived(
    [
      node.doneAt !== null ? "Done" : isStarted(node) ? "In progress" : "",
      hiddenChildren > 0 ? `Collapsed, ${hiddenChildren} hidden ${hiddenChildren === 1 ? "child" : "children"}` : "",
    ]
      .filter(Boolean)
      .join(". "),
  );

  let blockOpen = $state(false);
  let assignOpen = $state(false);

  /**
   * One blocker is a destination, not a choice — jump straight there. Several
   * need the menu, which is why the badge only claims aria-haspopup then.
   */
  function onBlockedClick(): void {
    const only = blockers.length === 1 ? blockers[0] : undefined;
    if (only !== undefined) store.revealNode(only.id);
    else blockOpen = !blockOpen;
  }
</script>

<div {id} class={["meta-row", { done: node.doneAt !== null, quiet }]}>
  {#if status !== ""}<span class="sr-only">{status}.</span>{/if}
  {#if progress.total > 0}
    <!-- Exact numbers only where attention is — see the store's captionIds. -->
    <ProgressBar
      done={progress.done}
      active={progress.active}
      total={progress.total}
      caption={store.captionIds.has(node.id)}
    />
  {/if}

  <!-- What the task or discussion waits on, and the way there: blockers cross
       the tree freely, so the badge is also the only affordance that takes the
       reader to one. Editing the list still belongs to the palette's Block…
       level. After the text it wrapped onto a line of its own the moment the
       prose filled the row — the same failure that moved assignment down.
       Progress stays first so sibling bars still line up; blocked before
       assignment because "cannot proceed" outranks who it is for; the age
       stays last, ambient. -->
  {#if blockers.length > 0}
    {@const title = blockedTitle(blockers)}
    {@const many = blockers.length > 1}
    <span class="badge-wrap" {@attach blockOpen && dismissable(() => (blockOpen = false))}>
      <button
        class="blocked"
        aria-haspopup={many ? "menu" : undefined}
        aria-expanded={many ? blockOpen : undefined}
        aria-label={`${title}\n${many ? "Click to pick a blocker" : "Click to go to the blocker"}`}
        {title}
        tabindex="-1"
        onclick={onBlockedClick}
      >
        <!-- Lucide lock, restroked to match the row's other icons. -->
        <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2.25" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" />
        </svg>
        <span>{many ? `Blocked ×${blockers.length}` : "Blocked"}</span>
      </button>
      <!-- `many` as well as blockOpen: a blocker completed elsewhere can drop
           the count to one under an open menu, and one blocker is no choice. -->
      {#if blockOpen && many}
        <Menu
          options={blockers}
          label="Go to blocker"
          onpick={(picked) => {
            blockOpen = false;
            store.revealNode(picked.id);
          }}
        >
          <!-- candidateLabel, so a row reads like the palette's "Block on…" rows
               and a 400-character node still occupies exactly one line. -->
          {#snippet item(blocker)}<span class="blocker">{candidateLabel(blocker)}</span>{/snippet}
        </Menu>
      {/if}
    </span>
  {/if}

  <!-- Who owns this task, parked here rather than after the text: inline it
       belongs to the last word, so a long row wraps it onto a line of its own
       and strands the badge where nothing scans for it. Here it sits in the
       row's fixed-height footer, next to the age it reads with. -->
  {#if node.assignee}
    {@const assignTitle = node.assignee === "human" ? "Assigned to you — agents skip this task" : "Assigned to agents"}
    <span class="badge-wrap" {@attach assignOpen && dismissable(() => (assignOpen = false))}>
      <button
        class={["assignee", { human: node.assignee === "human" }]}
        aria-haspopup="menu"
        aria-expanded={assignOpen}
        aria-label={assignTitle}
        title={assignTitle}
        tabindex="-1"
        onclick={() => (assignOpen = !assignOpen)}
      >
        <AssigneeIcon assignee={node.assignee} />
        <!-- Only human gets a word: agents skip those rows, so it is the one
             assignment worth the width. Hidden from AT — aria-label above
             already names the button, and would otherwise say it twice. -->
        {#if node.assignee === "human"}<span aria-hidden="true">Human</span>{/if}
      </button>
      {#if assignOpen}
        <Menu
          options={ASSIGNEE_VALUES}
          label="Assign"
          checked={(option) => option === nodeAssignee(node)}
          onpick={(picked) => {
            store.setAssignee(node.id, picked === "unassigned" ? null : picked);
            assignOpen = false;
          }}
        >
          {#snippet item(option)}
            <span class="menu-icon" aria-hidden="true">{#if option !== "unassigned"}<AssigneeIcon assignee={option} />{/if}</span>
            {ASSIGN_LABELS[option]}
          {/snippet}
        </Menu>
      {/if}
    </span>
  {/if}

  <time class="created" datetime={node.createdAt} title={createdTitle}>{createdAgo}</time>

  {#if actions}<span class="actions">{@render actions()}</span>{/if}
</div>

<style>
  /* Starts exactly where THIS row's text starts — the meta reads as a footer to
     its own row, not as the first of its children. Height is fixed rather than
     intrinsic, and one constant for every node: the bar comes and goes with the
     subtree, and neither it nor the caption may move anything when it does.
     Margin, not padding: height is 14px and the app is border-box. Below is
     the gap between nodes — without it the age sits as close to the next
     checkbox as to its own text, and could belong to either. Above is a
     breath so a tag chip on the last line of text does not kiss this row. */
  .meta-row {
    --meta-gap: 10px;
    --meta-dot: 3px;
    display: flex;
    align-items: center;
    gap: var(--meta-gap);
    height: 14px;
    margin-top: 3px;
    margin-bottom: 8px;
    padding-left: var(--text-col);
    user-select: none;
  }
  /* Folded away rather than display: none — the row is still the text's
     accessible description — keeping a little of the gap between nodes. */
  .meta-row.quiet {
    height: 0;
    margin: 0 0 4px;
    overflow: hidden;
    visibility: hidden;
  }
  /* Phones: a quarter of the scroll was meta rows, so they sit tighter. */
  @media (max-width: 639.98px) {
    .meta-row {
      --meta-gap: 8px;
      margin-top: 1px;
      margin-bottom: 5px;
    }
  }

  /* Read out, never seen. Absolutely positioned, so it is no flex item and
     takes no divider. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Pushed to the row's right end, with no divider (see below). */
  .meta-row > .actions {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-left: auto;
  }

  /* Dividers generated rather than placed: whatever this row grows later is
     separated without touching the markup, and nothing strands a dot at either
     end when the bar is away — only an item with something before it draws one.
     Drawn as a box, not a middot glyph: a glyph's size is hostage to the font's
     metrics and to the 11px it inherits, which renders it too small to read.
     :global because a later item may be a component root, which carries no
     scope class of ours. The invisible status, when present, leads the row
     and counts as nothing; the row buttons at the far end need no divider. */
  .meta-row > :global(:not(:first-child, .sr-only + *, .actions))::before {
    content: "";
    display: inline-block;
    width: var(--meta-dot);
    height: var(--meta-dot);
    border-radius: 50%;
    vertical-align: middle;
    margin-right: var(--meta-gap);
    background: color-mix(in srgb, var(--muted) 50%, transparent);
  }

  /* A 3px square after a strip of dashes reads as one more dash. Keep every
     other divider — including after the bar once its caption is showing,
     because that is text, not a dash. */
  .meta-row > :global(.bar.bare + *)::before {
    content: none;
  }

  /* Anchors a badge's menu, so it stays a positioned box of its own. Centred
     because the divider is generated inside it: centring is what puts that dot
     on the row's midline alongside the one in front of the timestamp. */
  .badge-wrap {
    position: relative;
    flex: none;
    align-self: center;
    display: flex;
    align-items: center;
  }
  /* As a flex container the wrap would generate its divider inside itself,
     widening the menu-anchor box and dropping the menu off the badge by a dot.
     Out of flow it draws in exactly the same place; the margin gives the row
     back the width the dot no longer holds. */
  .meta-row > .badge-wrap:not(:first-child, .sr-only + *) {
    margin-left: calc(var(--meta-dot) + var(--meta-gap));
  }
  .meta-row > .badge-wrap::before {
    position: absolute;
    right: 100%;
  }
  /* The reserved-dot margin would leave a hole once the divider is suppressed. */
  .meta-row > :global(.bar.bare + .badge-wrap) {
    margin-left: 0;
  }

  /* The pill shared by Blocked and the human badge: both are signals the
     reader hunts for at a scan distance, so they share weight, radius and
     deepen-on-approach; only the hue (--pill) differs. Sized to clear the
     meta row's fixed 14px and sit with the 11px timestamp. */
  .blocked,
  .assignee.human {
    gap: 4px;
    padding: 1px 6px;
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    color: var(--pill);
    background: color-mix(in srgb, var(--pill) 14%, transparent);
    user-select: none;
  }
  .blocked:is(:hover, :focus-visible, [aria-expanded="true"]),
  .assignee.human:is(:hover, :focus-visible, [aria-expanded="true"]) {
    color: var(--pill);
    background: color-mix(in srgb, var(--pill) 26%, transparent);
  }

  /* A button (it jumps to the blocker), so the UA's border and background are
     reset; at rest it must read as a status badge, not a control. The count
     only appears when more than one blocker is open. */
  .blocked {
    --pill: var(--blocked);
    display: inline-flex;
    align-items: center;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .blocked svg {
    width: 12px;
    height: 12px;
  }

  /* Blocker rows carry node text, not a fixed vocabulary; the cap keeps the
     menu from spanning the window. */
  .blocker {
    max-width: 264px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Both variants are built to land inside the meta row's fixed 14px: nothing
     on that row may ever reflow the outline, so the badge fits the row rather
     than the row growing for the badge. Agent = 12px icon + 1px ring of pad. */
  .assignee {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1px;
    border: none;
    border-radius: 999px;
    background: color-mix(in srgb, var(--fg) 9%, transparent);
    color: var(--muted);
    cursor: pointer;
  }
  /* The shared assignee icon ships at 14px, which both overpowers the row's
     11px text and busts its height budget. */
  .assignee :global(svg) {
    width: 12px;
    height: 12px;
  }
  .assignee:hover,
  .assignee[aria-expanded="true"] {
    color: var(--fg);
  }

  /* The human badge takes the pill above; agent keeps the quiet icon dot: it
     is the default, and defaults should not compete. */
  .assignee.human {
    --pill: var(--assigned-human);
  }

  /* Touch: the 14px-tall badges get 32px of hit area, drawn past the badge
     so the fixed-height row is untouched. */
  @media (pointer: coarse) {
    .blocked,
    .assignee {
      position: relative;
    }
    .blocked::after,
    .assignee::after {
      content: "";
      position: absolute;
      inset: -9px -4px;
    }
  }

  /* Unassigned keeps the icon column empty, so the labels line up. */
  .menu-icon {
    display: flex;
    width: 14px;
    color: var(--muted);
  }

  /* Same weight as the bar's caption — this is ambient provenance, and the
     exact timestamp is a hover away. */
  .created {
    font-size: 11px;
    line-height: 1;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* A finished node's badges and age are history, not live signals. The
     divider in front of each fades too, without being named here: it is
     generated inside the element, so it is part of what this opacity
     composites. */
  .meta-row.done :is(.blocked, .assignee.human, .created) {
    opacity: 0.6;
  }
</style>
