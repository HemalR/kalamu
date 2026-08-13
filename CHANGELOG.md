# Changelog

All notable changes to the `kalamu` CLI are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`kalamu` (the published CLI) is the single versioned package; its version is the
product version and every git tag tracks it. Landing, core, and web are private
and unversioned, but user-facing changes to the web UI that ship inside the CLI
are recorded here too.

Work lands under **[Unreleased]**. When you run `pnpm release <patch|minor|major>`,
the release script renames that heading to the new version and dates it — so the
notes you write here become the release notes automatically. Keep entries grouped
under `Added` / `Changed` / `Fixed` / `Removed`.

## [Unreleased]

### Added

- **`kalamu ls [id]` walks the outline one level at a time.** Root items first; `ls <id>` lists that node's children. A trailing `(N)` is the child count, so an agent can descend only into a promising branch instead of dumping the whole tree. `list --under <id>` is the other branch view (full subtree, filters still apply; `--depth` is relative to it).
- **Every row shows when it was created**, as a relative age that keeps ticking
  in a window you left open, with the exact local timestamp on hover. It sits
  in the same fixed-height strip as the progress bar, so nothing on the page
  moves as ages change or bars come and go.
- **The Blocked badge is now the way to what a row is waiting on.** Click it to
  jump to the blocker — with several open blockers it lists them first — and
  the target is revealed wherever it was hiding: a zoom it sits outside of is
  dropped, the folds above it are opened, and the active filters (including
  hide-completed) let it through until you change them next. Nothing is put
  back afterwards, so browser Back is the way home.
- **Mouse chords on the row**, for the two moves whose own target is small or
  absent: Cmd/Ctrl-click a row to collapse it, Alt-click to zoom into it. The
  whole row is the target, not the 10px chevron, and Shift-click is left alone
  so text selection still works.
- **`kalamu hub list` and `kalamu hub forget <slug>`**: see the projects the
  hub knows about — slug, name and path — and drop an entry you no longer want
  in the sidebar. Forgetting touches the registry only: the project's
  `.kalamu/` data is untouched, and the next kalamu command run inside it
  registers it again.
- The row you're editing is now tinted, so the caret's line stands out in a
  dense outline.
- **`kalamu link <id>`** prints a copy-ready, human-readable Markdown deep
  link to a node — the label plus its id, pointing at the node's real
  location in the hub — resolving the project's actual registered slug, so
  agents never guess a slug or port. `kalamu config base-url <url>` sets the
  machine-local hub address it links against (`default` to clear it), for
  anyone not running the hub on `http://localhost:4400`.
- **Human-assigned tasks (`@human`) carry a blue badge**, so a glance at the
  outline shows what's yours to do versus an agent's.

### Changed

- **`kalamu add` says where the node landed.** Nested creates print `Created n_xyz under Auth > Login`; a top-level add prints `(top-level)`. JSON includes `parentId` and `path`. A non-interactive add that omits `--parent` also warns, pointing at `kalamu ls` — humans adding a new top-level area are not nagged.
- **Search and filtered list print `Path:` when a parent is omitted**, so `list --open` and `search` no longer look like a fake tree. Unfiltered `list` is unchanged: indent is the path.
- **The command palette is a leader-key menu.** Cmd/Ctrl+K opens a panel with
  every action listed beside the single key that runs it — `⌘K d` toggles done,
  `⌘K p 1` sets p1, `⌘K v h` hides completed — so actions become short
  sequences you can learn by using them, with nothing to type and nothing to
  select. The keys are printed next to their labels, so none of it has to be
  memorised first. Rows are still clickable, Esc still steps back a level, and
  the new `⌘K 1…9` switches hub projects. Blockers, start/end and the view
  toggles are all on the menu now.
- **Copy is uniform across node kinds, and both copy keys changed meaning.**
  Cmd/Ctrl+C copies an agent-context block — a `Kalamu {kind} ID: {id}` header,
  the item's ancestor path, then the item and its whole subtree as nested
  markdown, with every sibling branch left out — so pasting one item into an
  agent chat carries the context that item sits in. Cmd/Ctrl+Shift+C copies
  only the item's raw text; it used to copy the item's id, which now travels in
  the context block's header. Every row carries the same copy button: a plain
  click copies context, a Cmd/Ctrl-click copies text.
- **Progress bars count the work beneath a node, not the node itself**, and now
  appear for any actionable descendant at any depth rather than only for direct
  children — so an umbrella several levels above the real tasks finally shows
  its progress.
- **Kind cycling moved from Cmd/Ctrl+Shift+Enter to Alt/Option+Enter** — the
  only shortcut that uses Alt, and it frees Shift+Enter. A claimed task's
  checkbox now shows a slowly pulsing amber dot in place of the old play glyph.
- **Assigning a bullet to Human or Agent in the command palette promotes it to
  a task in the same action**, instead of requiring a separate kind change first.
- Assignment badges moved into the same metadata row as priority and tags,
  instead of sitting apart from the rest of a row's metadata.

### Fixed

- Converting a node to a bullet now clears its assignee — previously a bullet
  could carry a stale `@human`/`@agent` badge left over from when it was a task.

### Removed

- **The discussion-only "Copy prompt" affordance.** Every node now has the same
  copy button, and the context block it produces carries the node's id and
  subtree; the do-not-code instruction that used to ride along lives in the
  agent skill and the standing instruction `kalamu init` plants.
- **`Mod+Shift+1…9` for switching hub projects**, replaced by `⌘K 1…9` in the
  palette. The old chord collided with macOS's Cmd+Shift+3/4/5 screenshot
  shortcuts; the leader sequence never can, since only the opening chord uses a
  modifier.

## [0.11.0] - 2026-08-10

### Added

- **Kalamu as an issue-tracker backend for skills: `kalamu init --wayfinder`.**
  Writes `docs/agents/issue-tracker.md` — the tracker doc
  [wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md)
  and its companions read — and plants a pointer to it in your
  `CLAUDE.md`/`AGENTS.md` (creating `AGENTS.md` when neither exists). The
  planning map and its tickets then live in your outline: the tree is the
  map/ticket hierarchy, `blockedBy` is the dependency edge, `startedAt` is the
  claim, and `kalamu next --under <map-id>` computes the frontier in one
  command. The wayfinder skill itself needs no modification. Safe to re-run:
  both files refresh in place on a later Kalamu update and your own text is
  never touched. Delete the generated line at the top of the tracker doc to
  take ownership of it and stop refreshes. See
  [`examples/wayfinder/`](examples/wayfinder/) for the template and a manual
  setup path.

### Changed

- **Discussions can be blocked, exactly as tasks can.** A conversation that
  can't usefully be had until other work lands — the design discussion waiting
  on a research task — is a real dependency, and now records as one:
  `kalamu block <id> --by <blockerId>` and `kalamu add --kind discussion
  --blocked-by <id>` accept discussions, `kalamu next --discussion` skips a
  blocked one until every blocker is done, `kalamu list --blocked` lists both
  kinds, and the UI's "Block on…" and Blocked badge cover discussions too.
  Cycles and dangling blocker references stay `kalamu validate` errors, and
  deletes strip the references, the same as for tasks. Bullets remain
  unblockable — they're structure, not work.
- **`kalamu init` now upgrades the agent instruction it planted earlier.**
  The standing Kalamu block in `CLAUDE.md`/`AGENTS.md` is fenced by markers,
  and re-running `init` replaces a stale block from an older Kalamu with the
  current text instead of leaving it as it was. Only the text between the
  markers changes; anything you wrote around it is untouched, and a block whose
  end marker you removed is left alone entirely.
- **A sharper standing instruction for agents**, in the planted block and in
  the `kalamu` agent skill. Agents add nodes in three enumerated cases — work
  discovered but deliberately not done, something only you can do
  (`--assign human`), or work you asked to be tracked — and nothing else, so
  findings and running commentary stay in chat instead of accumulating in your
  outline. New nodes must be placed under the branch they belong to rather than
  bolted onto the end, and agents no longer create discussions: those are yours
  to write.

## [0.10.0] - 2026-08-09

### Removed

- **`handoff` is gone** — the field, the `Handoff` type, `kalamu handoff` and
  `kalamu unhandoff`, `kalamu next --include-handed-off`, `kalamu list
  --handoff`, and `POST /api/nodes/:id/handoff`. In ten months of dogfooding
  not one node ever carried a non-null handoff: the forwarding address was a
  thing nobody looked up, paid for with a mandatory nullable field on every
  line of every outline. A task that outgrows Kalamu is now created in the
  other tracker and **deleted** here — Kalamu keeps no forwarding record, so
  an agent that promotes a task must delete it or the next agent will do the
  work again. Existing outlines still read: a non-null handoff merges into the
  node's text as the same `→ target:ref` suffix the CLI used to print, so
  nothing is silently discarded on upgrade; a null one is dropped.

### Added

- **Claim a task before working on it.** `kalamu start <id>` records
  `startedAt`, and `kalamu next` stops offering claimed tasks — two agent
  sessions no longer receive the same task and both do it. `kalamu end <id>`
  releases a claim without completing the task (back in the queue); `kalamu
  done` keeps `startedAt` as a record of how long the work took. Lingering
  claims from a session that died show up in `kalamu list --started` and are
  taken over with `kalamu start <id> --force`. In the UI a claimed task shows
  a play glyph in its checkbox, and the palette offers Start/End.
- **Blockers.** `kalamu block <id> --by <blockerId>` (repeatable, also
  `kalamu add --blocked-by`) records that a task waits on another node;
  `kalamu next` skips it until every blocker is done. `kalamu unblock <id>`
  clears one blocker or all of them, and `kalamu list --blocked` shows what's
  waiting. Blockers cross the tree freely — dependency order and outline order
  are different things — and both blocker cycles and references to missing
  nodes are `kalamu validate` errors. Deleting a node removes it from every
  `blockedBy` that mentions it. The palette has "Block on…" and "Unblock".
- **Provenance: Kalamu records who wrote each node.** Agent-created nodes get
  `"createdBy": "agent"` automatically — the web UI is always the human, a
  non-interactive CLI invocation is an agent — so no agent has to remember a
  flag. `--by human|agent` on `add`/`update` corrects the detection, and
  `kalamu list --created-by` filters by it. Authorship never affects the
  queue. This is what makes it safe for an agent to keep its own forward work
  in your outline: you can hide agent-created items while you're thinking.
- **Filter menu** in the UI header: show or hide items by who created them and
  who they're assigned to, with the show/hide-completed toggle (Cmd/Ctrl+Shift+H)
  now living in the same menu. Filters persist per project, and the ancestors
  of a matching item always stay visible so the outline never tears apart.
- **Compact mode**, a header toggle that shortens every row to a derived
  one-line label so a long outline stays scannable. Nothing is stored — the
  full text is there the moment you edit the row, and copy, the CLI and the
  file never see the label.
- **Progress bars**: any item with work beneath it carries a segmented bar
  showing what's done, what's in progress, and what's left, with exact counts
  where your attention is. Counts describe the real tree, so hiding completed
  items or filtering never makes progress move.
- `kalamu stop`: stops a `kalamu open` server (or a foreground `kalamu hub`)
  left running in a terminal tab you've lost track of. `open` and a
  foreground `hub` now write a PID lock (`.kalamu/server.lock`,
  `~/.kalamu/hub.lock`) on startup and clean it up on graceful shutdown; a
  launchd-installed hub is left to `kalamu hub uninstall`/`restart` instead,
  since `stop` would just get relaunched by `KeepAlive`.
- HTTP API: `POST /api/nodes/:id/start` (body `{"force": true}` to re-claim),
  `POST /api/nodes/:id/end`, `POST /api/nodes/:id/block` (409 on a cycle), and
  `DELETE /api/nodes/:id/block/:byId` (omit `:byId` to clear all).

### Changed

- The priority badge is now three small bars rather than the literal text
  `p1`/`p2`/`p3` — the same information at a glance without a word of jargon
  on every row.
- The hub sidebar's open-task count no longer excludes handed-off tasks
  (there are none); claimed and blocked tasks still count as open work.

### Fixed

- `GET /api/next` reported a missing priority as `3`; it now reports the real
  default, `2`. Only the API response was wrong — queue order was always
  correct.
- The server validated `ui-state.json` with its own copy of the schema, which
  had drifted from core's and silently stripped a view-state key on write. It
  now uses core's schema directly.

## [0.9.0] - 2026-07-20

### Changed

- The two Enter shortcuts swapped: Cmd/Ctrl+Enter now marks an item
  done/reopens it, and Cmd/Ctrl+Shift+Enter cycles the kind
  (bullet → task → discussion). Done is the more frequent action and gets
  the lighter combo.
- Priorities are now three levels instead of five: p1 = high, p2 = medium (the
  default — shows no badge), p3 = low. The CLI accepts `--p 1-3` (or
  `default`), inline `p1`–`p3` tokens still parse, and sorting is unchanged
  (p1 first). Existing files migrate automatically on read: legacy `4`/`5`
  become `3` (low); a stored `2` — previously "high" — now reads as medium.
- Every row now reserves the priority-badge column — bullets included — so
  text aligns vertically across bullets, tasks, and discussions. Hovering a
  bullet shows the same ghost badge as a default-priority task; picking p1 or
  p3 there (badge or palette) converts the bullet into a task.
- The priority menu dropped its separate "clear" entry: choosing
  p2 · medium (default) is how a priority is cleared.

### Added

- The right-gutter copy button now appears on every row, not just
  discussions: discussions keep "Copy agent prompt" (Mod+Shift+C twin),
  everything else copies the item and its sub-items as markdown (Mod+C twin).

### Fixed

- The right-gutter copy button vanished when the pointer travelled from the
  row into the gutter to click it — the gutter now counts as hovering the
  row, so the button stays put.
- The tag-chip colour popover in the outline inherited the row text's
  `pre-wrap` whitespace, leaving ~22px gaps between its sections; the popover
  now resets to normal whitespace (the sidebar's popover was unaffected).
- A launchd-installed hub kept serving old server code after a CLI update
  (assets refreshed from disk, the process didn't). The hub now watches its
  own bundle and exits once a replaced one settles on disk, letting launchd's
  KeepAlive restart it on the new code — `kalamu restart` still forces it
  immediately.

## [0.8.0] - 2026-07-19

### Added

- Zoom: focus any item as a temporary root, with a breadcrumb trail above the
  outline (Cmd/Ctrl+Shift+. to zoom in, Cmd/Ctrl+Shift+, or Escape to zoom
  out). The zoom level lives in the URL, so it survives reload and Back
  unwinds it.
- Hide completed items with Cmd/Ctrl+Shift+H (or the palette) when a list gets
  long; the setting persists per project.
- `http://` and `https://` URLs in item text now render as clickable links.
- Cmd/Ctrl+Shift+↑/↓ (and matching palette items) collapse the current item's
  parent or expand its children, moving the caret along with the fold.
- Pressing Enter on a numbered-list item (`1. …`) continues the numbering on
  the new sibling.
- `kalamu init` now adds `.kalamu`'s view-state and cache files to your
  `.gitignore` automatically when run inside a repo (`--no-gitignore` to skip);
  outside a repo it still just prints the suggested entries.
- The hub sidebar can be reordered by drag-and-drop; the order is remembered
  and keeps the Cmd/Ctrl+Shift+1…9 project shortcuts stable.

### Changed

- `kalamu open` now wakes an installed-but-stopped hub (macOS, `hub install`)
  and routes there, instead of falling back to a standalone server.

## [0.7.1] - 2026-07-15

### Fixed

- Installed web app (PWA) now presents a single, stable "Kalamu" identity
  instead of a per-project name, so installing from different projects no longer
  creates mismatched or duplicate app entries. The installed icon still takes
  the active project's colour.
- Closed a leak where navigating between projects in the hub left the previous
  project's live-update connection open; connections are now closed on
  navigation and restored when a page is revisited.

## [0.7.0] - 2026-07-15

### Added

- Visual identity: a bronze fanned-k wordmark and matching favicon that recolour
  to the active project's colour, in both the app and the hub.
- PWA manifest and app icons, so installing the web UI as an app uses the Kalamu
  mark; installed-app icons in the hub are tinted per project.

### Changed

- Interactive `kalamu init` now confirms before scaffolding `.kalamu/` in a
  directory that doesn't look like a code repository (no `.git`, `.gitignore`, or
  `package.json`), so a mistyped path can't create an outline in the wrong place.
  Agents and non-interactive runs are never prompted.

## [0.6.0] - 2026-07-13

### Added

- Notify users, on the command line and in the UI, when a newer `kalamu` is
  available on npm (checks about once a day; never self-updates).
- Colour, rename, and remove projects.

### Fixed

- Release script no longer clobbers the shipped CLI README with a stale buffer.

### Removed

- Stopped tracking the generated `packages/cli/README.md` (regenerated on build).

## [0.5.0] - 2026-07-13

### Changed

- `kalamu open` alone is all a user needs to remember to get going.

### Fixed

- Restored the README repeatedly lost to stale editor buffers during release.

## [0.4.0] - 2026-07-12

### Added

- Kalamu hub for managing multiple project outlines.
- `discussion` node kind — a topic to talk through, never coding work.

### Changed

- `init` tells agents, in their seeded instructions, to file human todos into
  Kalamu.
- Improved README and skill instructions.

## [0.3.0] - 2026-07-11

### Added

- Offer the onboarding tour immediately after install.

## [0.2.1] - 2026-07-11

### Fixed

- Post-`v0.2.0` release fixes.

## [0.2.0] - 2026-07-11

### Added

- Publish script for one-shot npm releases.
- Assign tasks to `agent` or `human`.
- Initial keyboard-first outliner UI.
