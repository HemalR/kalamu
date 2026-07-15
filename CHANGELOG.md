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

- Bronze fanned-k wordmark and matching favicon, tinted with the active
  project's colour.
- PWA manifest and app icons so installed apps use the Kalamu mark; installed-app
  icons in the hub are coloured to match their project.
- Landing page for [kalamu.dev](https://kalamu.dev) with a hero, plus Wrangler
  config for deploying it.

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
