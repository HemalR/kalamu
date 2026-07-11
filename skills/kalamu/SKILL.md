---
name: kalamu
description: Work with Kalamu, the repo-local task outliner. Use when a repository contains a .kalamu/ directory, or when asked to pick up the next task, record todos, track deferred work, or mark tasks done in a repo that uses Kalamu. Covers getting work (kalamu next), recording work (add, done, handoff), and the rules agents must follow (human-assigned tasks, priorities, bullets vs tasks).
license: MIT
compatibility: Requires Node.js >= 20 (commands run via npx kalamu or an installed kalamu binary)
metadata:
  author: kalamu
---

# Kalamu

Kalamu stores a repository's brainstorming and task state in one file: `.kalamu/outline.jsonl`. The developer edits it through a web UI; you use the CLI. If `kalamu` is not on PATH, every command below works as `npx kalamu <command>`.

**Never edit `.kalamu/outline.jsonl` by hand** unless the CLI is unavailable. Never touch `.kalamu/ui-state.json` or `.kalamu/meta.json` (cosmetic, owned by the UI).

## Getting work

```bash
kalamu next --format json      # the single most urgent task (exit 2 = nothing to do)
kalamu next --all              # the whole queue, priority order
kalamu next --under <id>       # scope to one branch of the outline
kalamu list --open             # everything still open
kalamu show <id> --children    # one node with its subtree
```

`next --format json` returns the task plus its full context: `ancestors` (the direct chain above it, root-first) and `descendants` (the task's own subtree — often repro notes or sub-steps left by the developer). Read them before starting.

## Recording work

```bash
kalamu add --kind task --text "Found while fixing X" --p 2 --parent <id>
kalamu add --kind task --text "<what the human must do>" --assign human
kalamu done <id>                                   # after completing the task
kalamu handoff <id> --target github --ref <url>    # promoted into another system
kalamu unhandoff <id>                              # external plan fell through
kalamu validate                                    # before finishing (exit 1 = invalid)
```

Defer work you discover but don't do: add it as a task rather than leaving TODO comments — in a Kalamu repo, the outline is the task system.

When your work needs the human to do something (a decision, a credential, a manual step outside the repo), don't just say so in chat — also record it as a human-assigned task so it survives the conversation.

## Rules

1. Only work on nodes where `kind` is `"task"`. Plain bullets are context, never work items.
2. Never work on tasks with `"assignee": "human"` (rendered as `@human`; legacy files may write `"self": true`): they belong to the developer. `kalamu next` already excludes them — but they may appear as descendants of a returned task; leave those to the human. Tasks with `"assignee": "agent"` or no assignee are yours.
3. Priority runs p1 (urgent) to p5 (low); a missing priority means p3. Set priority with `--p`; never write `"priority": 3` explicitly.
4. Tags live inline in task text as `#tokens` (`#web`, `#bug`) — there is no separate tags field. Keep them when editing text.
5. If you promote a task into another tracker (GitHub issue, Linear, a plan file), record it with `kalamu handoff` so other agents don't duplicate it.
6. When your work completes a task, mark it done and run `kalamu validate` before finishing.

## Recognising a Kalamu repo

A `.kalamu/` directory at the repository root (specifically `.kalamu/outline.jsonl`). If asked to set one up: `kalamu init`.
