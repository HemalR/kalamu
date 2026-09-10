---
name: kalamu
description: >-
  Manage tasks and human-led discussions in a Kalamu repository outline. Use for
  Kalamu work items, explicitly requested tracking, or deferred work that belongs
  in the outline. Ordinary repository work does not automatically need a node.
license: MIT
metadata:
  author: kalamu
---

# Kalamu

Requires Node.js 20 or newer.

Kalamu stores a repository's brainstorming and task state in `.kalamu/outline.jsonl`. The human edits it through the web UI; agents use the CLI. Edit JSONL by hand only when the CLI is unavailable, following the repository's data model. If `kalamu` is not on PATH, use `npx kalamu <command>`.

## When to use and when NOT to use

1. You are creating a plan with todos that will likely span across many sessions/days - in that case Kalamu can store the chronological order of that work and the human can see the status of the work as it gets done. Remember to insert tasks at the correct location/nesting to make visual sense to the user. If you come up with a to-do that you will do yourself in the immediate future, then you do not need to put it in Kalamu, your session context/ephemeral todo list/internal tools should be sufficient.
2. If the human needs to do something at some point down the line, Kalamu is a good place to store it. If they need to do something right away, this session, then just tell them on the spot, no need to put it in Kalamu unless they specifically ask you to.
3. The outline is a parking lot for deferred work, never a log of the current
session. You add nodes in exactly three cases, always `--kind task`: work
discovered but deliberately not done in this session, a human-assigned task for
something only the human can do, or work the user explicitly asked to track.
Findings, summaries, and topics under live discussion are never recorded — when
unsure, don't; say it in chat and let the human park it. Never create a
`--kind discussion` node: discussions are the human's tool (the one exception
is a human-invoked workflow whose own spec creates discussion nodes).
4. Placement is part of the record. The outline is the developer's thinking
space, so a new node must land where they would look for it. Do not dump the
whole outline. Walk one level at a time:

```bash
kalamu ls                 # top-level items; (N) = number of children
kalamu ls <id>            # that node's children; repeat until the parent is obvious
```

Or `kalamu search <term>` if you already have a keyword — each hit includes its
`Path`. Then pass `--parent <id>`. Work discovered while doing a task usually
belongs under that task or its umbrella; a human-assigned follow-up belongs
under the work that raised it. Add at top level only when the node starts a
genuinely new area, never because finding the parent takes effort. `add`
without `--parent` reports `(top-level)` so you can see the mistake.
5. When working on a Kalamu-originated task, defer work you discover but don't do:
add it as a task rather than leaving TODO comments — in a Kalamu repo, the
outline is the task system.

Keep the outline focused on deferred work; do not add a node for work already underway in the current conversation.

## Communicating with the human about Kalamu nodes

Node IDs are handles for agents and the CLI, not names a human can recognize.
Never refer to a node by ID alone in user-facing messages.

- When you mention a node in any user-facing message — including end-of-turn
  summaries — reference it with its Markdown deep link. `add`, `done`, `start`,
  and `next` already print one on a `Link:` line (a `link` field in
  `--format json`): paste that. For any other node, run `kalamu link <id>`,
  which resolves the machine's configured hub address and the project's actual
  stable slug. Never assemble or guess the URL yourself.
  - Good: `[Fix duplicate task creation](http://localhost:4400/p/kalamu#z=n_0JC1YXY9BV) (n_0JC1YXY9BV)`
  - Bad: `n_0JC1YXY9BV` or `(n_0JC1YXY9BV)` — an ID with no name and no link.
- The plain-text form — first line of the node's text, ID in parens:
  `Fix duplicate task creation (n_0JC1YXY9BV)` — is a fallback for when no link
  can be produced (`kalamu link` errors, or the output medium cannot render
  Markdown), not an alternative to linking.
- When describing a relationship, name every node involved. For example:
  `Deploy the release (n_release) is blocked by Fix migration ordering
  (n_migration)`, not `n_release is blocked by n_migration`.
- Do not paste a node's full multiline text when its first line identifies it
  clearly. Add only the context needed for the human to understand why the node
  matters.

## Getting work

```bash
kalamu next --format json      # the single most urgent task (exit 2 = nothing to do)
kalamu next --all              # the whole queue, priority order
kalamu next --under <id>       # scope to one branch of the outline
kalamu ls                      # one level at the root; (N) = children
kalamu ls <id>                 # one level under that node
kalamu list --open             # everything still open
kalamu show <id> --children    # one node with its subtree
kalamu link <id>               # copy-ready named deep link for a human
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

Discussions can also be claimed. When the human starts a discussion, run
`kalamu start <id>` before discussing it; it leaves `next --discussion` until
ended or done. A claim coordinates sessions; it does not turn a discussion
into permission to implement code.

## Recording work

```bash
kalamu add --kind task --text "Found while fixing X" --p 2 --parent <id>
kalamu add --kind task --text "<what the human must do>" --assign human --parent <id>
kalamu block <id> --by <blockerId>                 # <id> waits on another node
kalamu unblock <id> [--by <blockerId>]             # clear one blocker, or all
kalamu done <id>                                   # after completing the task
kalamu validate                                    # before finishing (exit 1 = invalid)
```

Record real dependencies with `block` (repeatable `--by`, or `--blocked-by` on
`add`): a blocked task or discussion is skipped by `next` (and `next
--discussion`) until every blocker is done, so ordering lives in the data
instead of in your memory. A node cannot block itself or depend on its own
ancestor, and dependency cycles are invalid.

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
3. When creating or editing a task try and get the first line of the text to be short and descriptive so that in the compact overview view, it's easy for the human to scan and get a summary of the detail hidden from view.
4. Never work on tasks with `"assignee": "human"` (rendered as `@human`; legacy files may write `"self": true`): they belong to the human. `kalamu next` already excludes them — but they may appear as descendants of a returned task; leave those to the human. Tasks with `"assignee": "agent"` or no assignee are yours.
5. Priority runs p1 (high) to p3 (low); a missing priority means p2 (medium). Set priority with `--p`; never write `"priority": 2` explicitly.
6. Tags live inline in task text as `#tokens` (`#web`, `#bug`) — there is no separate tags field. Keep them when editing text.
7. If you promote a task into another tracker (GitHub issue, Linear, a plan file), create it there and then delete the Kalamu task — Kalamu keeps no forwarding record, so leaving it would let another agent duplicate the work.
8. When your work completes a task, mark it done and run `kalamu validate` before finishing.
9. Every node mentioned in a user-facing message gets its Markdown link — reuse the `Link:` line from the `add`/`done`/`start`/`next` output you already have, or run `kalamu link <id>`. Bad: `(n_0JC1YXY9BV)` with no link. See "Communicating with the human" above.

## Recognising a Kalamu repo

Linked Git worktrees share the main checkout's `.kalamu/`. Keep the main
checkout on its default branch and use worktrees for other branches; changing
the main checkout's branch changes the committed outline visible to everyone.
The CLI and hub warn when the main checkout is off its default branch.

Reference longer prose with repo-relative `.md` paths, optionally followed by
`#heading-slug`. The UI can open or peek at the referenced section; agents read
the file directly. `kalamu validate` warns about missing files without failing
validation. Keep the prose in the file and task state in the outline.

A `.kalamu/` directory at the repository root (specifically `.kalamu/outline.jsonl`). If asked to set one up: `kalamu init`.

The presence of `.kalamu/` alone does not mean every request must be added to
or completed in Kalamu. Use the CLI for tasks sourced from Kalamu and for
explicit tracking requests; otherwise follow the user's normal workflow.
