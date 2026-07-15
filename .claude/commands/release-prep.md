---
description: Prep a Kalamu release — review docs/tour, write the changelog, commit & sync, and recommend a release type
argument-hint: "[optional: bump hint like 'minor', or 'release' to also publish]"
---

You are running the Kalamu **release-prep** workflow. Its job is everything up to
(and optionally including) the npm publish. The actual publish is done by
`scripts/release.mjs` via `pnpm release <patch|minor|major>` — do NOT reimplement
version bumping, tagging, or `npm publish`; that script owns them and stamps the
CHANGELOG `[Unreleased]` section to the real version automatically.

Read `CLAUDE.md`, `SPEC.md` (canonical — do not relitigate settled decisions),
and `scripts/release.mjs` if you need context. `$ARGUMENTS` may contain a bump
hint (`patch`/`minor`/`major`) or the word `release` (meaning: after prep, go on
to actually publish). Treat it as a hint, not a command — still evaluate the
release type yourself.

Work through these steps **in order**, pausing where noted. Do not batch past a
pause.

## 1. Establish what changed since the last publish

- Last published version anchor: `git describe --tags --abbrev=0 --match "v*"`
  (cross-check against `packages/cli/package.json` version — that field is the
  source of truth for what's live on npm; a tag may be missing, e.g. v0.5.0 was).
- Gather the change set:
  - `git log <lastTag>..HEAD --oneline` — committed work since the anchor.
  - `git status --porcelain` and `git diff` / `git diff --staged` — uncommitted
    work (there is almost always something).
- Summarise, grouped by user-facing impact: new features, changes, fixes,
  removals, and internal-only churn (build/tooling/tests). Note which package(s)
  each touches — only `packages/cli` (the `kalamu` bin) and `packages/web` (the
  UI it serves) reach users; `core`, `landing`, and tooling do not ship to npm.

## 2. Review README and the onboarding tour — pause for approval

Decide whether the changes require updates to either:

- **README.md** (root — this is what npm renders and ships; never edit
  `packages/cli/README.md`, it is regenerated from root by the build). Look for
  new/changed commands, flags, behaviours, or install/quickstart drift. Do NOT
  touch the `**Current version: vX.Y.Z**` line — `release.mjs` owns it.
- **The onboarding tour** in `packages/cli/src/tour.ts` — the `TOUR` tree seeded
  by `kalamu init --tour`. If a change alters a keybinding, command, or concept
  the tour teaches, update the relevant `TourNode` text. Keep every task
  `assignee: "human"` and demo-flagged per SPEC.md; go through the
  **svelte-developer agent** only if the change reaches into `.svelte`/`.svelte.ts`
  (tour.ts itself is plain TS — edit directly).

If either needs changes, make them, then **show me the diff and wait for my OK**
before continuing. If neither needs changes, say so explicitly and continue.

## 3. Update the changelog

Edit `CHANGELOG.md`, adding entries under the existing `## [Unreleased]` heading
only (do NOT invent a version number or date — `release.mjs` stamps those at
publish time). Group under `Added` / `Changed` / `Fixed` / `Removed`. Write
user-facing notes, not commit messages; omit internal-only churn unless it
matters to users. Follow the tone of the entries already in the file.

## 4. Commit and get onto main

- Record the starting branch: `git branch --show-current`.
- Stage and commit all pending work with clear message(s) (the changelog edit,
  any README/tour edits, plus whatever else is dirty). If `git status` shows a
  conflict (`UU`/`AA`) or anything you did not expect to be uncommitted, STOP and
  surface it — do not blindly `git add -A` over a merge conflict.
- If the starting branch is not `main`: `git checkout main` then
  `git merge <startingBranch>` (prefer a fast-forward or a clean merge; if it
  conflicts, stop and tell me).

## 5. Sync to origin

`git push` (from `main`). Confirm it succeeded.

## 6. Recommend a release type

Kalamu is pre-1.0. Use this mapping (state your reasoning against the actual
change set):

- **major** — a breaking CLI/flag change, a `.kalamu` data-model/JSONL change, or
  a deliberate 1.0 milestone. For a data-model change, confirm with me first (see
  the "ask before data-model changes" rule).
- **minor** — any new user-facing feature or notable behaviour change.
- **patch** — fixes, docs, and internal-only changes with no new capability.

## 7. Summarise and hand off

Print:

- What you changed (README/tour/changelog edits, commits made, branch merged,
  push result).
- The `[Unreleased]` changelog notes as they now stand.
- Your recommended release type **with reasoning**, and the exact command:
  `pnpm release <type>`.

Then, unless I asked you to `release`, **stop here** — I run the publish.

### If I asked you to also publish

`npm has 2FA`, so `npm publish` needs a one-time code. `release.mjs` accepts
`--otp <code>` and passes it through. TOTP codes expire in ~30–90s, so:

1. Confirm the recommended `<type>` with me.
2. Ask me for a **fresh** 6-digit OTP right before running (not earlier).
3. Immediately run `pnpm release <type> --otp <code>`.
4. If npm rejects the code as invalid/expired: the version was already bumped,
   committed, and tagged locally but not published/pushed — do NOT re-run
   `pnpm release` (it would double-bump). Instead recover with a fresh code:
   `cd packages/cli && npm publish --otp=<fresh>` then `git push --follow-tags`.
5. Report the published version and that main + tags are pushed.
