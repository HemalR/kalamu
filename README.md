<img src="assets/logo.svg" alt="" width="72" align="left" hspace="16" />

# Kalamu

[![skills.sh](https://skills.sh/b/hemalr/kalamu)](https://skills.sh/hemalr/kalamu)

A repo-local, keyboard-first outliner for turning developer thoughts into agent-ready tasks. — [kalamu.dev](https://kalamu.dev)

Your outline lives in your repository as one diffable file — `.kalamu/outline.jsonl` — with no cloud, no account, and no daemon. You brainstorm in a fast keyboard-first web UI; your coding agents consume the same outline through a CLI built for them.

**Current version: v0.10.0**

## Install

Nothing to install — run it straight from npm (Node ≥ 20):

```bash
npx kalamu open
```

Or install globally:

```bash
npm install -g kalamu
```

**Using a Node version manager?** A global npm install lives inside whichever Node runtime was active when you ran it (`…/node/24.19.0/lib/node_modules/kalamu`), so installing a newer Node — or a manager that rolls forward on its own — can leave the `kalamu` on your `PATH` pointing at an older copy. The symptom is `kalamu --version` disagreeing with what you just installed. With [Vite+](https://viteplus.dev), install it outside any single runtime instead:

```bash
vp install -g kalamu
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
- **⌘K** — command palette: priority, labels, done, mine, start/block, copy CLI commands
- **⌘Enter** — done/reopen · **⌘⇧Enter** — cycle bullet/task/discussion · **⌘.** — collapse · **⌘⇧C** — copy the item's id
- **?** — the full cheat sheet
- Inline tokens as you type: `p1`…`p3` set priority, `#tag` becomes a coloured chip, `@human` keeps a task for yourself, `@agent` marks it as agent work

Two view controls sit in the header. **Compact mode** shortens every row to a derived one-line label so a long outline stays scannable — nothing is stored, and the full text comes back the moment you edit. The **filter menu** hides items by who wrote them (you or an agent) and who they're assigned to, and holds the show/hide-completed toggle (⌘⇧H). Any item with work beneath it carries a segmented progress bar showing what's done, what's in progress, and what's left.

Commit `.kalamu/` with your code — the outline's line order is the outline, so diffs stay readable.

## All your projects on one page

```bash
kalamu hub
```

One local server for every Kalamu project on your machine: `http://127.0.0.1:4400` shows them all in a sidebar, and any repo you've run a `kalamu` command in appears there automatically. It runs in the foreground and installs nothing — Ctrl+C and it's gone (or `kalamu stop` if you've lost track of which tab it's in — this also stops a standalone `kalamu open` server for the current project). While a hub is running, `kalamu open` routes your browser to it instead of starting another server — and if you've `hub install`ed but it's not currently running, `open` wakes it first.

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

In the UI a discussion shows a speech-bubble glyph with a **Copy prompt** affordance: paste it into an agent session, talk it through, and the agent records the outcome as child bullets and marks the discussion done. Discussions can't be assigned, and completing one never blocks the follow-up tasks recorded beneath it.

## Claims and blockers

Two agent sessions running `kalamu next` used to receive the same task and both do the work. Now an agent claims a task before starting it, and Kalamu keeps the ordering that used to live in someone's head:

```bash
kalamu start <id>              # claim it — next stops offering it to other sessions
kalamu end <id>                # abandoned without finishing: back in the queue
kalamu list --started          # claims still open (--force re-claims a dead one)
kalamu block <id> --by <id2>   # <id> waits on <id2>; next skips it until <id2> is done
kalamu unblock <id>            # clear one blocker, or all of them
```

Blockers cross the tree freely — dependency order and outline order are different things — and a blocker cycle is a validation error, exactly like a parent cycle. In the UI, a claimed task shows a play glyph in its checkbox, and ⌘K offers **Start**, **Block on…**, and **Unblock**.

Kalamu also records *who wrote* each node, without anyone having to remember a flag: anything created from the web UI is yours, anything an agent creates from a non-interactive shell is marked `createdBy: "agent"`. That's what makes it safe for an agent to keep its own forward work in your outline — filter agent-created items out while you're thinking.

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
kalamu start <id>              # claim the task first, so a second session can't take it
kalamu add --kind task --text "Found while fixing X" --p 2 --parent <id>
kalamu block <id> --by <id2>   # record a dependency; blocked tasks are skipped by next
kalamu done <id>               # after completing the originating task
kalamu end <id>                # abandoned without finishing — back in the queue
kalamu validate                # before finishing
```

**Rules:**

1. Only work on nodes where `kind` is `"task"` — plain bullets are context, not work.
2. Never work on tasks with `"assignee": "human"` (rendered as `@human`; legacy files may write `"self": true`): they belong to the developer. `kalamu next` already excludes them. Tasks with `"assignee": "agent"` or no assignee are yours.
3. A `discussion` node is a conversation deliverable, not coding work. Plain `next` never returns one; when the user points you at a discussion (or you query `next --discussion`), discuss — do not write code — record the outcome as child bullets, then mark it done.
4. Priority runs p1 (high) to p3 (low); a missing priority means p2 (medium).
5. Before starting, run `kalamu next` or inspect the relevant task nodes, and claim the task with `kalamu start <id>` — an unclaimed task can be picked up twice.
6. If you promote a task into another system (a GitHub issue, Linear, a plan file), move it there and delete it here — Kalamu keeps no forwarding record.
7. After completing Kalamu-originated work, mark the originating task done and
   run `kalamu validate`. Do not run `kalamu done` for ordinary direct requests.

## The data

`.kalamu/outline.jsonl` — one node per line, line order **is** sibling order. Nodes are bullets (thoughts), tasks (agent-executable work), or discussions. Tags live inline in node text as `#tokens`; priority, `assignee`, `createdBy`, `startedAt`, and `blockedBy` are fields, each omitted at its default so lines stay short. `ui-state.json` (collapse state) and `meta.json` (tag colours) are cosmetic and safe to ignore or delete — `kalamu init` adds them, plus the local cache, to your `.gitignore` automatically. See [SPEC.md](SPEC.md) for the full data model.

## Development

pnpm monorepo: `packages/core` (data model and operations), `packages/cli` (the `kalamu` binary and local server), `packages/web` (Svelte UI).

```bash
pnpm install
pnpm test       # Vitest across the workspace
pnpm build      # web assets + single self-contained CLI bundle
```

`SPEC.md` is canonical — read it before making design decisions.
