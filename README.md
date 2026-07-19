<img src="assets/logo.svg" alt="" width="72" align="left" hspace="16" />

# Kalamu

[![skills.sh](https://skills.sh/b/hemalr/kalamu)](https://skills.sh/hemalr/kalamu)

A repo-local, keyboard-first outliner for turning developer thoughts into agent-ready tasks. — [kalamu.dev](https://kalamu.dev)

Your outline lives in your repository as one diffable file — `.kalamu/outline.jsonl` — with no cloud, no account, and no daemon. You brainstorm in a fast keyboard-first web UI; your coding agents consume the same outline through a CLI built for them.

**Current version: v0.8.0**

## Install

Nothing to install — run it straight from npm (Node ≥ 20):

```bash
npx kalamu open
```

Or install globally:

```bash
npm install -g kalamu
```

Kalamu checks npm about once a day and tells you — on the command line and in the UI — when a newer version is out (it never updates itself). That daily check is the only network call it makes; turn it off with `export KALAMU_NO_UPDATE_CHECK=1` or `kalamu config update-check off`.

## Quickstart

```bash
cd your-repo
kalamu init --tour                           # creates .kalamu/ + a self-guided tour outline
kalamu open                                  # browser UI on 127.0.0.1 — take the tour
kalamu add --kind task --text "Fix login redirect" --p 1
```

In the UI, everything is a keystroke away:

- **Enter / Tab / Shift+Tab** — new item, indent, outdent
- **⌘K** — command palette: priority, labels, done, mine, copy CLI commands
- **⌘⇧Enter** — done/reopen · **⌘.** — collapse · **⌘⇧C** — copy the item's id
- **?** — the full cheat sheet
- Inline tokens as you type: `p1`…`p5` set priority, `#tag` becomes a coloured chip, `@human` keeps a task for yourself, `@agent` marks it as agent work

Commit `.kalamu/` with your code — the outline's line order is the outline, so diffs stay readable.

## All your projects on one page

```bash
kalamu hub
```

One local server for every Kalamu project on your machine: `http://127.0.0.1:4400` shows them all in a sidebar, and any repo you've run a `kalamu` command in appears there automatically. It runs in the foreground and installs nothing — Ctrl+C and it's gone. While a hub is running, `kalamu open` routes your browser to it instead of starting another server — and if you've `hub install`ed but it's not currently running, `open` wakes it first.

Like it? Make it permanent (macOS):

```bash
kalamu hub install     # start the hub at login; uninstall fully reverses it
kalamu restart         # restart the installed hub (e.g. after updating kalamu)
```

`install` does exactly one thing: writes a human-readable launchd file to `~/Library/LaunchAgents/dev.kalamu.hub.plist` so the hub starts at login and restarts if it crashes. It stays bound to `127.0.0.1` — nothing ever leaves your machine — and logs to `~/.kalamu/hub.log`.

No server is ever required for the CLI itself: every command reads and writes `.kalamu/outline.jsonl` directly. Servers exist only to power the browser UI.

## Discussions

Some work items aren't "go build this" but "talk this through with me". Mark those as discussions — a third node kind that never enters the agent task queue:

```bash
kalamu add --kind discussion --text "How should auth sessions work?"
kalamu next --discussion       # the discussion queue, kept separate from tasks
kalamu list --discussions
```

In the UI a discussion shows a speech-bubble glyph with a **Copy prompt** affordance: paste it into an agent session, talk it through, and the agent records the outcome as child bullets and marks the discussion done. Discussions can't be assigned or handed off, and completing one never blocks the follow-up tasks recorded beneath it.

## Agent guide

Give your agents this knowledge as a skill (works with Claude Code, Cursor, Codex, Copilot, and any [Agent Skills](https://agentskills.io)-compatible agent):

```bash
npx skills add hemalr/kalamu    # or say yes when `kalamu init` offers it
```

Kalamu stores repo-local brainstorming and task state. If you are a coding agent working in a repo with a `.kalamu/` directory:

**Use the CLI.** Do not edit `.kalamu/outline.jsonl` by hand unless the CLI is unavailable.

This applies to work that originated from Kalamu or that the user explicitly
asked to track in Kalamu. A direct user request is not automatically a Kalamu
task merely because the repository contains `.kalamu/`; do not create or
complete a task for ordinary direct work unless the user supplied a Kalamu task
ID or requested tracking.

**Getting work:**

```bash
kalamu next --format json      # the single most urgent task, with its ancestor
                               # chain and subtree for full context (exit 2 = nothing to do)
kalamu next --all              # the whole queue in priority order
kalamu next --under <id>       # scope to one branch of the outline
kalamu list --open             # everything still open
kalamu show <id> --children    # a node with its subtree
```

**Recording work:**

```bash
kalamu add --kind task --text "Found while fixing X" --p 2 --parent <id>
kalamu done <id>               # after completing the originating task
kalamu handoff <id> --target github --ref <url>   # promoted into another system
kalamu unhandoff <id>          # the external plan fell through; work comes back
kalamu validate                # before finishing
```

**Rules:**

1. Only work on nodes where `kind` is `"task"` — plain bullets are context, not work.
2. Never work on tasks with `"assignee": "human"` (rendered as `@human`; legacy files may write `"self": true`): they belong to the developer. `kalamu next` already excludes them. Tasks with `"assignee": "agent"` or no assignee are yours.
3. A `discussion` node is a conversation deliverable, not coding work. Plain `next` never returns one; when the user points you at a discussion (or you query `next --discussion`), discuss — do not write code — record the outcome as child bullets, then mark it done.
4. Priority runs p1 (urgent) to p5 (low); a missing priority means p3.
5. Before starting, run `kalamu next` or inspect the relevant task nodes.
6. If you promote a task into another system, record it with `kalamu handoff`.
7. After completing Kalamu-originated work, mark the originating task done and
   run `kalamu validate`. Do not run `kalamu done` for ordinary direct requests.

## The data

`.kalamu/outline.jsonl` — one node per line, line order **is** sibling order. Nodes are bullets (thoughts), tasks (agent-executable work), or discussions. Tags live inline in node text as `#tokens`; priority and `assignee` are fields. `ui-state.json` (collapse state) and `meta.json` (tag colours) are cosmetic and safe to ignore or delete — `kalamu init` adds them, plus the local cache, to your `.gitignore` automatically. See [SPEC.md](SPEC.md) for the full data model.

## Development

pnpm monorepo: `packages/core` (data model and operations), `packages/cli` (the `kalamu` binary and local server), `packages/web` (Svelte UI).

```bash
pnpm install
pnpm test       # Vitest across the workspace
pnpm build      # web assets + single self-contained CLI bundle
```

`SPEC.md` is canonical — read it before making design decisions.
