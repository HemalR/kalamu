---
name: kalamu
description: Work with Kalamu, the repo-local task outliner. Use when asked to pick up, inspect, update, defer, or complete a Kalamu task, or when explicitly asked to track work in Kalamu. Covers getting work (kalamu next, start), recording work (add, done, block), and the rules agents must follow (human-assigned tasks, priorities, bullets vs tasks).
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

### Claim before you work

```bash
kalamu start <id>              # claim the task; next stops offering it to other sessions
kalamu done <id>               # finished — startedAt stays as a record of the work
kalamu end <id>                # abandoning WITHOUT finishing: return it to the queue
kalamu start <id> --force      # re-claim a task whose claiming session died
```

When you take a task from `next`, run `kalamu start <id>` before doing the work —
that is what stops a second agent session picking up the same task. If you stop
without completing it, `kalamu end <id>` puts it back in the queue; a claim you
neither finish nor release leaves the task invisible to `next` until someone
forces it (`kalamu list --started` shows lingering claims).

## Recording work

```bash
kalamu add --kind task --text "Found while fixing X" --p 2 --parent <id>
kalamu add --kind task --text "<what the human must do>" --assign human
kalamu block <id> --by <blockerId>                 # <id> waits on another node
kalamu unblock <id> [--by <blockerId>]             # clear one blocker, or all
kalamu done <id>                                   # after completing the task
kalamu validate                                    # before finishing (exit 1 = invalid)
```

Record real dependencies with `block` (repeatable `--by`, or `--blocked-by` on
`add`): a blocked task or discussion is skipped by `next` (and `next
--discussion`) until every blocker is done, so ordering lives in the data
instead of in your memory. Blockers may point at any node anywhere in the
outline.

Only record work in Kalamu when it originated from Kalamu or the user explicitly
asked for it to be tracked there. Direct user requests are not Kalamu tasks just
because the repository contains a `.kalamu/` directory. In particular, do not
create a task with `kalamu add` or mark one done with `kalamu done` for ordinary
direct user work unless the user supplied a Kalamu task ID or requested tracking.

The outline is a parking lot for deferred work, never a log of the current
session. You add nodes in exactly three cases, always `--kind task`: work
discovered but deliberately not done in this session, a human-assigned task for
something only the human can do, or work the user explicitly asked to track.
Findings, summaries, and topics under live discussion are never recorded — when
unsure, don't; say it in chat and let the human park it. Never create a
`--kind discussion` node: discussions are the human's tool (the one exception
is a human-invoked workflow whose own spec creates discussion nodes).

Placement is part of the record. The outline is the developer's thinking
space, so a new node must land where they would look for it: read the tree
first (`kalamu list`, `kalamu search <term>`, or the `ancestors` context you
already hold from `next --format json`) and pass `--parent <id>` — work
discovered while doing a task usually belongs under that task or its umbrella,
and a human-assigned follow-up belongs under the work that raised it. Add at
top level only when the node starts a genuinely new area, never because
finding the parent takes effort.

When working on a Kalamu-originated task, defer work you discover but don't do:
add it as a task rather than leaving TODO comments — in a Kalamu repo, the
outline is the task system.

When your work needs the human to do something (a decision, a credential, a manual step outside the repo), don't just say so in chat — also record it as a human-assigned task so it survives the conversation.

### Authorship is recorded for you

Every node you create is marked `"createdBy": "agent"` automatically — Kalamu
detects that the CLI is not attached to a terminal. Never pass a flag for this.
`--by human|agent` exists only to correct the detection in odd cases, such as a
human driving `kalamu add` from inside a script.

This is what makes it safe to keep your own forward work in the outline. The
developer can hide agent-created nodes while they are thinking, so recording a
follow-up task for yourself no longer clutters the space they brainstorm in.

Authorship never affects the queue: a task you created for yourself is exactly
as eligible for `kalamu next` as one the developer wrote for you. It is also
independent of assignment — `createdBy` says who wrote a node, `assignee` says
who should do it, and the useful combination is a task you created and assigned
to the human (`--assign human`) when you need something from them.

## Rules

1. Only work on nodes where `kind` is `"task"`. Plain bullets are context, never work items.
2. Nodes with `kind: "discussion"` are conversations the developer wants to have with an agent, never coding work. `kalamu next` never returns them, and you never create them — discussions are authored by the human. When the human brings one to a session (usually by pasting a discussion prompt), discuss only — make no code changes, record the agreed outcome as child bullets under the discussion node (`kalamu add --parent <id> --text "..."`), then `kalamu done <id>`. Query them with `kalamu next --discussion` (most urgent first) or `kalamu list --discussions`.
3. Never work on tasks with `"assignee": "human"` (rendered as `@human`; legacy files may write `"self": true`): they belong to the developer. `kalamu next` already excludes them — but they may appear as descendants of a returned task; leave those to the human. Tasks with `"assignee": "agent"` or no assignee are yours.
4. Priority runs p1 (high) to p3 (low); a missing priority means p2 (medium). Set priority with `--p`; never write `"priority": 2` explicitly.
5. Tags live inline in task text as `#tokens` (`#web`, `#bug`) — there is no separate tags field. Keep them when editing text.
6. If you promote a task into another tracker (GitHub issue, Linear, a plan file), create it there and then delete the Kalamu task — Kalamu keeps no forwarding record, so leaving it would let another agent duplicate the work.
7. When your work completes a task, mark it done and run `kalamu validate` before finishing.

## Recognising a Kalamu repo

A `.kalamu/` directory at the repository root (specifically `.kalamu/outline.jsonl`). If asked to set one up: `kalamu init`.

The presence of `.kalamu/` alone does not mean every request must be added to
or completed in Kalamu. Use the CLI for tasks sourced from Kalamu and for
explicit tracking requests; otherwise follow the user's normal workflow.
