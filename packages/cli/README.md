# Kalamu

[![skills.sh](https://skills.sh/b/hemalr/kalamu)](https://skills.sh/hemalr/kalamu)

A repo-local, keyboard-first outliner for turning developer thoughts into agent-ready tasks. — [kalamu.dev](https://kalamu.dev)

Your outline lives in your repository as one diffable file — `.kalamu/outline.jsonl` — with no cloud, no account, and no daemon. You brainstorm in a fast keyboard-first web UI; your coding agents consume the same outline through a CLI built for them.

## Install

Nothing to install — run it straight from npm (Node ≥ 20):

```bash
npx kalamu open
```

Or install globally:

```bash
npm install -g kalamu
```

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
- Inline tokens as you type: `p1`…`p5` set priority, `#tag` becomes a coloured chip, `@me` keeps a task for yourself

Commit `.kalamu/` with your code — the outline's line order is the outline, so diffs stay readable.

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
2. Never work on tasks with `"self": true` (or shown as `(self)`): they belong to the developer. `kalamu next` already excludes them.
3. Priority runs p1 (urgent) to p5 (low); a missing priority means p3.
4. Before starting, run `kalamu next` or inspect the relevant task nodes.
5. If you promote a task into another system, record it with `kalamu handoff`.
6. After completing Kalamu-originated work, mark the originating task done and
   run `kalamu validate`. Do not run `kalamu done` for ordinary direct requests.

## The data

`.kalamu/outline.jsonl` — one node per line, line order **is** sibling order. Tags live inline in node text as `#tokens`; priority and `self` are fields. `ui-state.json` (collapse state) and `meta.json` (tag colours) are cosmetic and safe to ignore or delete. See [SPEC.md](SPEC.md) for the full data model.

## Development

pnpm monorepo: `packages/core` (data model and operations), `packages/cli` (the `kalamu` binary and local server), `packages/web` (Svelte UI).

```bash
pnpm install
pnpm test       # Vitest across the workspace
pnpm build      # web assets + single self-contained CLI bundle
```

`SPEC.md` is canonical — read it before making design decisions.
