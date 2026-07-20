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
