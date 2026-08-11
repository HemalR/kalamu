# Kalamu Build Brief

## Product summary

Build **Kalamu**, a brutally simple, repo-local, keyboard-first outliner for solo developers and coding agents.

Kalamu is inspired by Workflowy-style infinite bullet nesting, but designed specifically for coding projects. It gives a developer a lightweight place to think, brainstorm, decompose ideas, and mark some items as executable tasks. Agents can then inspect the structured scratchpad, pick the next task deterministically, and mark work complete.

The core product promise:

> Kalamu is a repo-local outliner for turning developer thoughts into agent-ready tasks.

The product should be:

* Local-first
* Git-friendly
* Fast
* Keyboard-first
* Agent-friendly
* Simple enough to understand by looking at one file

The canonical data source is a JSONL file stored inside the project repository.

Kalamu's two differentiators — the reasons it beats a `TODO.md` — are:

1. A Workflowy-quality outliner UI for brainstorming.
2. A deterministic CLI contract for agents (stable IDs, `next`, `done`).

Everything else is in service of those two. If a feature strengthens neither, it does not belong.

---

## Key design decisions

These were deliberated and are settled. Do not relitigate them during implementation.

1. **Line position is canonical sibling order.** There is no `order` field. The writer always emits the file in pre-order traversal; the parser is lenient. See [Outline ordering](#outline-ordering).
2. **`p1` is high, `p3` is low.** (Amended 2026-07-20: three levels replace the original five.) Matches P0/P1-is-highest developer convention. Missing priority means `p2` (medium, the default). `next` sorts priority ascending. Legacy files with `4`/`5` read as `3` and are rewritten on the next write.
3. **`done` carries queue semantics on tasks only.** (Amended 2026-08-10: bullets CAN be marked done for strikethrough and their `doneAt` never affects `next` eligibility or umbrella closing; bullets remain non-work-items. `clean`, however, deletes any done node with its entire subtree regardless of kind.)
4. **A done ancestor TASK closes its subtree.** Tasks under it are ineligible for `next`. Done bullets never close anything (see 3). (Amended 2026-08-08: handed-off ancestors closed a subtree too, until `handoff` was removed — key decision 18.)
5. **Live reload is not optional.** The server watches the file and pushes changes to the UI; all writers use mtime-checked atomic writes. See [Concurrency](#concurrency).
6. **The UI ships with undo and delete.** A keyboard-first tool that moves subtrees without undo loses user data and trust.
7. **Tags live inline in the text.** A tag IS its `#token` in the node's text ("Build a new #feature to do xyz") — there is no `tags` field; tags are derived from the text. Chips are a rendering of the token in place: unfocused nodes show chips, the focused node shows raw text, so tags are edited and deleted like any other text. Colours are derived deterministically from the tag name (overridable in `meta.json`). No tag-management commands — a tag exists because text mentions it.
8. **Assignment: human or agent.** (Amended 2026-07-10: replaces the earlier `self: true` flag.) `assignee: "human"` marks a task the developer keeps for themselves — `next` never returns it. `assignee: "agent"` explicitly marks agent work; omitted means unassigned, which is agent-eligible exactly like `"agent"`. This is still audience, not people: the only two values are the developer at the keyboard and their agents — Kalamu has no concept of users. Legacy `"self": true` reads as `assignee: "human"` and is rewritten on the next write.
   In the command palette, Assign is available on bullets as a promotion shortcut: choosing Human or Agent converts the bullet to a task and assigns it in one operation. Discussions remain unassignable.
9. **Per-node plain-text contenteditable, no editor library.** Each node's text is its own `contenteditable="plaintext-only"` element using Svelte's native bindings (`bind:textContent`). Structural keys (Enter, Tab, Backspace-on-empty) are intercepted — guarded by `event.isComposing` for IME — and become outline operations; token parsing writes back only on commit (Enter/blur), never mid-keystroke, since external updates to bound content reset the caret. No TipTap/ProseMirror — those are document editors, and Kalamu's structure lives in the data model, not the editor. Fallback if the spike finds trouble: a roaming single editor where only the focused node is live. The UI spike exists to validate this.
10. **Collapse state is view state, never document content.** It lives in a gitignored `.kalamu/ui-state.json`, not in `outline.jsonl` — otherwise every fold click dirties the canonical file and pollutes Git history. Agents and the CLI always operate on the full tree regardless of what is collapsed.
11. **Images are files referenced by inline markdown tokens.** Pasting an image stores it in `.kalamu/assets/` (content-hashed filename, COMMITTED — assets are outline content and must survive a clone) and inserts `![](.kalamu/assets/img-<hash>.<ext>)` into the node text. Same rendering model as tags: unfocused nodes show a thumbnail in place, the focused node shows the raw token. No new node field; agents see an ordinary greppable path.
12. **Discussions are a third node kind.** (Added 2026-07-12.) `kind: "discussion"` marks a work item whose deliverable is a conversation between the developer and an agent — "talk this through with me" rather than "go build this". Discussions are never mixed into the agent task queue — `next` never returns them (agents must never treat them as coding work); `next --discussion` queries the discussion queue explicitly, with the same eligibility and sort — including blockers, since a discussion can be blocked exactly as a task can (key decision 16, amended 2026-08-10). They can never be assigned (they involve both parties by definition) and never claimed, so neither `assignee` nor `startedAt` ever gates a discussion. Priority is allowed purely as human-facing ordering — setting one never converts the node to a task. A done discussion never closes its umbrella for queue eligibility, so its children remain available until cleanup; `clean` deletes any done node with its entire subtree. The flow is human-initiated: the UI renders a discussion with a speech-bubble glyph and the same agent-context copy affordance as every other node; the agent discusses, records the outcome as child bullets, and marks the discussion done.
13. **One hub, many projects.** (Added 2026-07-12.) `kalamu hub` runs a single machine-global server (default port 4400, still `127.0.0.1`-only) that mounts every registered project behind one UI with a project sidebar — no per-project server spin-up, no per-project ports. Projects are identified in hub URLs by a human-readable slug derived from `package.json` `name` (scope stripped) or the directory name, deduplicated with numeric suffixes and **stable once assigned**. The registry lives at `~/.kalamu/projects.json` — machine-global plumbing, never canonical outline data. The hub is human UI convenience only; agents and the CLI contract never depend on it. See [Hub](#hub-multi-project-dashboard).
14. **Update checks: default-on, opt-out, human-only.** (Added 2026-07-13.) Every install path (`npx` caches, global installs and the launchd hub never self-update) can silently run a stale binary, so Kalamu tells the human when a newer version is on npm. This is the one deliberate outbound network call in an otherwise `127.0.0.1`-only tool — a single throttled GET to `registry.npmjs.org`, never analytics, never a phone-home of outline data. It is **on by default with a first-run notice** and opts out via `KALAMU_NO_UPDATE_CHECK`, `CI`, or `~/.kalamu/config.json` (`kalamu config update-check off`). The check is best-effort and non-blocking: the latest version is cached in `~/.kalamu/update-check.json` for ~24h, and offline/slow/opted-out all degrade to silence, never an error or a delay. It surfaces two ways — a CLI banner on **stderr** shown only to a human at a TTY (so agents and `--format json` never see it), and a dismissible chip in the web UI/hub (`/api/project` reports `version`/`latestVersion`/`updateAvailable`). Purely advisory: Kalamu never self-updates. See [Update checks](#update-checks).
15. **Provenance is recorded, and never asked for.** (Added 2026-08-08.) `createdBy` records who authored a node — `"human"` or `"agent"`, omitted meaning human. `assignee` cannot express this: a task the developer wrote and pointed at an agent and a task the agent invented for itself both carry `assignee: "agent"`, but only the second one clutters the developer's thinking space. Recording provenance is what lets Kalamu be an agent's durable task store without polluting the human's outline, and what makes "hide agent-created nodes" a view the human can switch on. It is set automatically and never depends on agent cooperation — an agent that must remember a flag will forget it, and a provenance field that is wrong half the time is worse than none. Resolution order: an explicit `--by` flag, then the web UI (always `human`), then the TTY heuristic already established for update banners (decision 14) — a non-interactive CLI invocation is an agent or a script, an interactive TTY is the developer typing.
16. **Blockers point one way: `blockedBy`.** (Added 2026-08-08.) A task records what blocks it (`blockedBy: string[]` of node IDs). There is deliberately no reverse `blocks` array. Two directions must be kept in sync, and they drift: dex stores both (`blocker.blocks[]` ↔ `blocked.blockedBy[]`) and its own cycle check reads both "for robustness against data inconsistencies" — a bug class Kalamu declines to buy. One direction cannot disagree with itself. `blockedBy` is also the direction the hot path needs: `next` asks "is this task blocked?", answerable from the node alone, while "what does finishing this unblock?" is a cold UI query derived by scanning. It matches the existing `parentId` shape — the dependent points at its dependency, and there is no `children[]` array either. Blockers may cross the tree freely; a blocker cycle is a validation error exactly as a parent cycle is. (Amended 2026-08-10: discussions are blockable too. A discussion whose conversation cannot usefully happen until other work lands — the grilling/prototype ticket that waits on a research task — is a real dependency of exactly the same shape, and recording it in the data is the whole point of decision 16. `blockedBy` on a discussion carries full semantics: `next --discussion` skips it, cycles and dangling references are the same validation errors, and deletes strip it the same way. Bullets remain unblockable — they are structure, not work.)
17. **In-progress is a timestamp, not a status.** (Added 2026-08-08.) `startedAt` marks a task an agent has claimed, for the same reason SPEC declines a `done` boolean (see [`doneAt`](#doneat)): timestamps carry when as well as whether, and never accumulate into a status enum. Without it, two agent sessions both call `kalamu next`, both receive the same task, and both do the work. `next` skips claimed tasks; `kalamu start <id> --force` re-claims one whose owner died. State in Kalamu is exactly three timestamps — `createdAt`, `startedAt`, `doneAt` — and never a workflow.
18. **`handoff` is removed; promoting a task means deleting it.** (Added 2026-08-08.) A task that outgrows Kalamu is created in the external tracker and then deleted here. Recording *where it went* was a mandatory nullable field on every line of every outline, and in ten months of dogfooding not one node ever carried a non-null value — the forwarding address turned out to be a thing nobody looked up. The `handoff` field, the `Handoff` type, `kalamu handoff`/`unhandoff`, `next --include-handed-off`, `list --handoff`, and `POST /api/nodes/:id/handoff` are all gone. The consequence is deliberate: Kalamu keeps no record of promoted work, so an agent that creates a GitHub issue from a task **must** delete the task, or the next agent will do it again. Readers still accept a legacy `handoff` and fold a non-null one into the node's text as the same `→ target:ref` suffix the CLI used to render, so upgrading never silently discards a reference; a null one carried no information and is dropped.

---

## Name

Product name: **Kalamu**

CLI binary:

```bash
kalamu
```

The `kalamu` package name is unclaimed on npm (as of 2026-07-09) — claim it early.

Example usage:

```bash
kalamu open
kalamu next
kalamu add --kind task --text "Fix broken upload" --p 1
kalamu done n_123
```

---

## Core use case

A solo developer working inside a Git repo wants a lightweight place to think through what to build.

They launch:

```bash
kalamu open
```

This starts a local web server and opens a browser UI.

Inside the browser UI, they create nested bullets like:

```text
• Auth improvements
  • SSO
    ☐ Investigate WorkOS org mapping p2
    ☐ Add SAML config screen
  • Login UX
    ☐ Fix password reset redirect p1
```

Most nodes are just thoughts. Some nodes are tasks.

Agents only act on nodes where:

```ts
kind === "task"
```

The agent can run:

```bash
kalamu next
```

and receive the next task deterministically.

---

## Non-goals

Do **not** build a full project management system.

Kalamu is not Linear, Jira, GitHub Issues, or Todoist.

**Amended 2026-08-08:** Dex and Backlog.md were previously on that list. They are
not any more. Kalamu deliberately covers the durable agent-task-store role those
tools occupy — an agent holding work it must do later, with dependencies between
items — because splitting that across Kalamu, an agent's own memory, and a
tracker is what made agents unsure where anything belonged. See key decisions
15–17. The trackers above stay non-goals. A task that outgrows Kalamu is created in
the tracker and then deleted here (key decision 18) — Kalamu never becomes one.

This changes what Kalamu covers, not what it is. The tone section still governs:
tiny, local, fast, plain-text adjacent, git-native. If a feature can only be
explained by pointing at Jira, it does not belong here.

Avoid:

* Multi-user assignments (the two-value `assignee` — human vs agent — is audience, not users)
* Due dates
* Comments
* Rich task workflows beyond `startedAt` and `blockedBy` (no custom states, no transitions, no approvals)
* Complex status fields — state is timestamps (`startedAt`, `doneAt`), never a status enum
* Kanban boards (a roadmap view over `blockedBy` is planned; a board of drag-between-columns states is not)
* Multi-user permissions
* Cloud sync
* Authentication
* Databases as the canonical source of truth
* Complex scoring formulas

Kalamu should stay close to:

> nested bullets + tasks + priority + agent CLI

---

## Storage

Canonical storage is JSONL.

Default location:

```text
.kalamu/outline.jsonl
```

Additional metadata file:

```text
.kalamu/meta.json
```

`meta.json` contains this for MVP:

```json
{"version": 1}
```

plus, optionally, tag colour overrides (see [Tags](#tags)):

```json
{
  "version": 1,
  "tags": {
    "backend": "#7c9cf5"
  }
}
```

`version` exists so future format migrations have something to key on. Nothing else goes in this file.

UI view state (collapse/expand), gitignored:

```text
.kalamu/ui-state.json
```

Shape:

```json
{"collapsed": ["n_002", "n_014"], "hideDone": true}
```

`ui-state.json` is written by the server (debounced, atomic) and is never canonical: missing or corrupt means every node renders expanded. `kalamu validate` ignores it. IDs of since-deleted nodes are harmless and may be pruned opportunistically. `hideDone` (the UI's "hide completed items" eye toggle) is omitted when false, per the omit-defaults convention.

Optional runtime cache, if needed later:

```text
.kalamu/cache.sqlite
```

But `cache.sqlite` is never canonical and is gitignored.

`.gitignore` entries:

```gitignore
.kalamu/cache.sqlite
.kalamu/ui-state.json
.kalamu/*.lock
```

`kalamu init` writes these itself when the directory carries a repo marker
(the `looksLikeRepo` heuristic): missing entries are appended to the root
`.gitignore` (created when absent) under a `# Kalamu` comment. Idempotent per
line, it also runs on re-init so existing projects adopt it; a `.gitignore`
that already ignores the whole `.kalamu/` directory is left alone.
`--no-gitignore` skips it. Without a repo marker nothing is written — init
prints the entries as a suggestion instead.

The canonical JSONL file should be suitable for:

* Git diffs
* Agent inspection
* Manual emergency editing
* Simple validation

Each line in `outline.jsonl` is one node.

---

## Data model

Use this model for each node:

```ts
type NodeKind = "bullet" | "task" | "discussion";

type KalamuNode = {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  text: string;
  createdAt: string;
  doneAt: string | null;
  startedAt?: string;
  priority?: 1 | 2 | 3;
  assignee?: "human" | "agent";
  createdBy?: "agent";
  blockedBy?: string[];
};
```

The last three are optional and omitted at their defaults, so existing outlines
stay byte-identical until a node actually uses one. `createdBy` is only ever
written as `"agent"` — human authorship is the default and is never persisted,
exactly as `priority: 2` is never persisted.

There is deliberately no `order` field — sibling order is the relative order of lines in the file. See [Outline ordering](#outline-ordering).

There is also deliberately no `collapsed` field — collapse state is view state and lives in the gitignored `.kalamu/ui-state.json` (key decision 10), never in the outline.

There is deliberately no `blocks` field — blocker edges point one way only (key decision 16).

There is deliberately no `status` field — state is `startedAt` and `doneAt` (key decision 17).

There is deliberately no `handoff` field — a promoted task is deleted, not forwarded (key decision 18).

### Field notes

#### `id`

Stable unique ID.

Use short, readable IDs.

Example:

```text
n_01JZABC123
```

IDs must not change when nodes move.

#### `parentId`

`null` means top-level node.

#### `kind`

Allowed values:

```ts
"bullet" | "task" | "discussion"
```

* `bullet` means thought/text/heading
* `task` means agent-executable work item
* `discussion` means a conversation to have with an agent (key decision 12) — never coding work, never returned by `next`

Agents should only work on `task` nodes.

#### `text`

Plain text content.

No Markdown requirement for MVP, but Markdown-like text is fine.

#### `createdAt`

ISO timestamp.

Set on node creation.

#### `doneAt`

Nullable ISO timestamp. Only meaningful for `kind: "task"` — bullets have no done state.

```ts
doneAt === null
```

means not done.

```ts
doneAt !== null
```

means done.

Do not add a separate `done` boolean.

#### `priority`

Optional.

Only meaningful for `kind: "task"` and `kind: "discussion"` (where it is purely human-facing ordering — discussions never reach `next`).

Allowed values:

```ts
1 | 2 | 3
```

Default priority is `2` (medium).

Do not write `"priority": 2` unless there is a strong reason. Missing priority means default priority.

Setting a priority (1–3) on a `bullet` — via `add`, `update`, or the UI — converts it into a `task`, unless a kind is passed explicitly in the same call. Priorities are never silently inert on bullets you just prioritized; clearing back to default (`--p default` or `2`) never converts. Setting a priority on a `discussion` never converts it — priority is meaningful there (key decision 12).

Semantics — **lower number is more urgent**, matching P0/P1 developer convention:

```text
p1 = high / pick first
p2 = medium/default
p3 = low
```

Legacy note: files written under the original five-level scale may carry `4` or `5`; readers clamp both to `3` (low) and rewrite on the next write.

#### tags (derived, not stored)

There is deliberately no `tags` field. A tag is a `#token` inline in `text` ("Build a new #feature to do xyz") and the tag set is derived by scanning text for whole-word `#[a-z0-9][a-z0-9-]*` tokens (case-insensitive; derived names are lowercased for filtering and colour). This keeps the JSONL line readable and greppable, lets a tag double as a word in the sentence, and makes tag editing ordinary text editing.

Legacy note: files written before this decision may carry a `tags` array; readers merge any such tags into the text as trailing `#tokens` and drop the field on the next write.

See [Tags](#tags) for colour and UI behaviour.

#### `assignee`

Optional. Only meaningful for `kind: "task"`.

Allowed values:

```ts
"human" | "agent"
```

`"human"` means the developer is keeping this task for themselves — agents must never pick it up, and `kalamu next` never returns it. `"agent"` explicitly marks the task as agent work. Omitted means unassigned: agent-eligible, exactly like `"agent"`, just not explicitly claimed. Omit the field when unassigned — never write a null/empty assignee.

Discussions can never be assigned — they involve both parties by definition; `add`/`update` reject `--assign` on a discussion.

This is audience, not users. Kalamu has no user accounts; the only two parties are the developer at the keyboard and their agents.

Legacy note: files written before this decision may carry `"self": true`; readers treat it as `assignee: "human"` and drop the field on the next write.

#### `createdBy`

Optional. Meaningful on every kind, not just tasks.

Only ever written as `"agent"`. Omitted means the human authored the node —
the default, never persisted.

`assignee` says who *should do* a node; `createdBy` says who *wrote* it. They
are independent, and the pair the developer cares about is the one `assignee`
alone cannot distinguish:

| Node | `createdBy` | `assignee` | Meaning |
| --- | --- | --- | --- |
| Developer writes a task for an agent | *omitted* | `"agent"` | delegated work |
| Agent records work it must do later | `"agent"` | `"agent"` | the agent's own queue |
| Agent asks the developer for something | `"agent"` | `"human"` | agent → human request |
| Developer brainstorms a bullet | *omitted* | *omitted* | thinking |

Only the second row should be hideable while the developer is thinking, which
is why `assignee` cannot carry this on its own.

Resolution, in order (key decision 15):

1. An explicit `--by human|agent` flag on `add`/`update`
2. The web UI and the hub, which always write `human`
3. `KALAMU_ACTOR=human|agent` in the environment
4. The TTY heuristic — non-interactive CLI writes `"agent"`, an interactive TTY writes human

The heuristic is the same one decision 14 uses to keep update banners away from
agents, and it is a heuristic: a human piping `kalamu add` inside a script is
recorded as an agent. That is an acceptable error, and `--by` corrects it. What
matters is that the common cases — an agent shelling out, a human in the web UI
— are right without anyone having to remember anything.

#### `startedAt`

Optional ISO timestamp. Only meaningful for `kind: "task"`.

Set by `kalamu start <id>`, cleared by `kalamu end <id>` — `start`/`end` is the
natural pair, and `kalamu stop` is unavailable because it already means "stop
the running server". Present with a null `doneAt` means in progress; `kalamu
done` sets `doneAt` and leaves `startedAt` in place as a record of how long the
work took.

A claimed task is skipped by `kalamu next`, so a second agent session does not
pick up work already underway. `kalamu reopen` clears `startedAt` — a reopened
task must return to the queue, and one still carrying a claim would be invisible
to `next` forever. If the claiming session dies, the task is not
lost — it is listed by `kalamu list --started`, and `kalamu start <id> --force`
re-claims it.

There is no status enum, and no `inProgress` boolean, for the same reason there
is no `done` boolean (see [`doneAt`](#doneat)).

#### `blockedBy`

Optional array of node IDs. Meaningful for `kind: "task"` and `kind:
"discussion"` (key decision 16, amended 2026-08-10); on a bullet it is inert,
preserved but never consulted.

The task cannot proceed — or the discussion cannot usefully be had — until
every listed node is done. Omit the field when empty — never write
`"blockedBy": []`.

```json
"blockedBy": ["n_003", "n_007"]
```

Blockers are independent of the tree: a blocker may be any node anywhere in the
outline, including one in an unrelated subtree. That is the point — dependency
order and outline order are different things, and forcing dependencies into
parent/child would corrupt the outline as a thinking tool.

Direction is one-way by decision (key decision 16). A node never records what it
blocks; that view is derived by scanning for nodes whose `blockedBy` contains
this ID.

Rules:

* A blocker reference to a missing node is a validation error, reported by `kalamu validate`
* Deleting a node removes it from every `blockedBy` array that mentions it
* Blocker cycles are a validation error, exactly as parent cycles are
* A blocked task is never returned by `kalamu next`, and a blocked discussion is never returned by `kalamu next --discussion` (see [Deterministic next-task logic](#deterministic-next-task-logic))
* Done blockers do not block — only open ones do
* Any node may *be* a blocker — bullets and discussions included; only the blocked side is restricted to tasks and discussions

---

## Example JSONL

```jsonl
{"id":"n_001","parentId":null,"kind":"bullet","text":"Auth improvements","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null}
{"id":"n_002","parentId":"n_001","kind":"bullet","text":"SSO","createdAt":"2026-07-09T07:01:00.000Z","doneAt":null}
{"id":"n_003","parentId":"n_002","kind":"task","text":"Investigate WorkOS org mapping #research","createdAt":"2026-07-09T07:02:00.000Z","doneAt":null,"priority":3}
{"id":"n_004","parentId":"n_002","kind":"task","text":"Add SAML config screen","createdAt":"2026-07-09T07:03:00.000Z","doneAt":null}
{"id":"n_005","parentId":"n_001","kind":"bullet","text":"Login UX","createdAt":"2026-07-09T07:04:00.000Z","doneAt":null}
{"id":"n_006","parentId":"n_005","kind":"task","text":"Fix password reset redirect","createdAt":"2026-07-09T07:05:00.000Z","doneAt":null,"priority":1}
{"id":"n_007","parentId":null,"kind":"task","text":"Write launch blog post #publishing","createdAt":"2026-07-09T07:06:00.000Z","doneAt":null,"assignee":"human"}
```

Note the file is in pre-order traversal: each node's descendants immediately follow it. The writer always emits this shape.

---

## Outline ordering

**Line position is the canonical sibling order.** There are no order keys.

Rules:

* **Parsing is lenient.** Sibling order is the relative order in which siblings appear in the file, wherever their lines sit. A hand-edited or merge-mangled file that interleaves subtrees still parses deterministically.
* **Writing is strict.** The writer always emits pre-order traversal: each node followed by its descendants, siblings in order. A subtree is therefore a contiguous block of lines.
* **Moves are block moves.** Moving a node repositions its contiguous subtree block, which produces clean, readable Git diffs.
* `kalamu validate` warns (not errors) when the file is not in pre-order traversal, since the next write will normalize it.
* `kalamu next` uses this outline order as its tie-breaker.

---

## Deterministic next-task logic

Implement:

```bash
kalamu next
```

Eligibility — a node is eligible when all of the following hold:

```ts
node.kind === "task"
node.text.trim() !== ""
node.doneAt === null
node.startedAt === undefined
node.assignee !== "human"
// AND no ancestor task of the node is done
// AND every node in node.blockedBy is done
```

The discussion queue (`next --discussion`) applies the same rules with
`node.kind === "discussion"`, minus the two a discussion can never carry:
`startedAt` and `assignee` are inert on discussions (never claimed, never
assigned), so only a stale value from a past life as a task could be present
and it never gates. Blockers do gate (key decision 16, amended 2026-08-10).

Blank tasks (whitespace-only text, typically stray empty nodes from the web
UI) are never returned — an agent cannot act on a task with no text.
`kalamu clean` removes them.

The ancestor rule: marking a parent task done (or handing it off) closes the whole umbrella. Agents should never pick up work under a closed parent. Bullet ancestors never affect eligibility.

Human-assigned tasks (`assignee: "human"`) are never returned — they belong to the developer, not the agent queue. Unassigned and `"agent"` tasks are equally eligible.

Claimed tasks (`startedAt` set, `doneAt` still null) are never returned — another
session is already on them (key decision 17). `kalamu list --started` shows them
and `kalamu start <id> --force` re-claims one whose owner died.

Blocked tasks are never returned, and neither are blocked discussions. A node is
blocked while any node in its `blockedBy` is still open; blockers that are done
no longer block. A blocker that is itself blocked still blocks — the check is
one level deep on open-ness, and transitivity falls out of the blocker never
being done.

`createdBy` never affects eligibility. A task the agent wrote for itself is
exactly as eligible as one the developer wrote for it — provenance is for the
human's views, not the queue.

Sorting:

1. Priority **ascending** (p1 first), where missing priority means `2`
2. Outline order

So a `p1` task is selected before a `p2` task, regardless of outline position.

Within the same priority bucket, outline order wins.

This gives the developer a quick override mechanism. If they become aware of an urgent bug, they can quickly add:

```bash
kalamu add --kind task --text "Fix upload crash" --p 1
```

and the agent will pick it next without the human needing to manually reorder the outline.

MVP includes only:

```bash
kalamu next
kalamu next --format json
kalamu next --limit <n>
kalamu next --all
```

`--limit <n>` / `--all` return the next n (or all) eligible tasks in queue order, so an agent can load several tasks into context at once. Plain `next` keeps its single-task output; batch JSON is `{"count": N, "tasks": [{id, text, priority, path}, ...]}`. Exit code 2 with `{"count": 0, "tasks": []}` when nothing is eligible.

`kalamu all` is an alias for `kalamu next --all` (same options apart from `--all`/`--limit`).

There is no `--explain` flag — the default text output already includes the reason line.

Later (not MVP):

```bash
kalamu next --under <id>
```

---

## CLI requirements

The CLI is the primary interface for agents.

The web UI is for humans.

The JSONL file is the shared source of truth.

### Required MVP commands

```bash
kalamu init
kalamu open
kalamu list
kalamu show <id>
kalamu add
kalamu update <id>
kalamu move <id>
kalamu delete <id>
kalamu done <id>
kalamu reopen <id>
kalamu search <query>
kalamu next
kalamu clean
kalamu validate
```

### `kalamu init`

Initialises Kalamu in the current repo.

Creates:

```text
.kalamu/
  outline.jsonl
  meta.json
```

Should not overwrite existing data.

`init --tour` seeds a self-guided onboarding outline into a **fresh, empty**
outline only (it refuses otherwise). The tour teaches the UI by being an
outline: checkbox/done, priorities, tag chips, assignment, collapse, the palette,
and the cheat sheet. Every tour task is `assignee: "human"` AND says in prose that it is a
demo — agents must never treat tour items as work; `kalamu next` on a
tour-only outline exits 2.

Interactively (TTY, not JSON mode), a **fresh** `init` in a directory with no
repo marker — no `.git` (directory or worktree file), `.gitignore`, or
`package.json` directly in the cwd; deliberately no walk-up, since Kalamu is
repo-local and an init anywhere but a repo root is suspect — first asks
"This doesn't look like a code repository — initialise Kalamu in `<cwd>`
anyway? [y/N]" and stops on no. The default is **no**: when the heuristic
fires, a wrong-directory accident is the likelier case. Re-init on an existing
project never asks, and non-TTY runs (agents, scripts — including scaffolds
where `git init` hasn't happened yet) are never prompted and proceed as before.
This guard is the only gate on hub registration: registration is a side effect
of use on an already-initialised project, so guarding `init` (and `open`'s
bootstrap below) keeps wrong directories out of the hub without the
registration path ever prompting or failing.

Interactively (TTY, not JSON mode), a fresh `init` ASKS "Seed a two-minute tour
outline to learn the UI? [Y/n]" instead of requiring the flag; `--tour` forces,
`--no-tour` suppresses the question. Non-TTY runs (agents, scripts) are never
prompted and never seeded — a fresh non-interactive init just prints a one-line
hint that `init --tour` exists.

`init` also plants a standing instruction in the project's **agent docs**: a
marked block telling agents that work requiring the human (a decision, a
credential, a manual step) must be recorded as a task via
`kalamu add ... --assign human`, not just mentioned in chat. The block is
appended to every `CLAUDE.md`/`AGENTS.md` that exists at the root, or a new
`AGENTS.md` is created when neither does. Idempotent (the `<!-- kalamu:agents -->`
marker is the already-installed check), so it also runs on re-init — existing
projects adopt it by re-running `kalamu init`. `--no-agent-docs` skips it.

In the same spirit, `init` maintains the repo's `.gitignore`: when the
directory carries a repo marker it appends the missing `.kalamu` view-state and
cache entries (see ".gitignore entries" above); `--no-gitignore` skips it.

When run interactively (TTY), `init` then offers to install the **Kalamu agent
skill** by delegating to `npx skills add <owner/repo>` — the skills.sh CLI asks
which agents to install for and owns every agent's skills directory. `--skill`
forces the install, `--no-skill` suppresses the offer, and a non-TTY run (an
agent or script) never prompts.

Finally, an interactive `init` launches `kalamu open` so the human lands in the
UI. `--no-open` suppresses this, `--open` forces it even non-interactively.
Non-TTY runs (agents, scripts) and `--format json` never auto-open — an agent
must never end up holding a server.

The skill itself lives at `skills/kalamu/SKILL.md`, follows the agent-agnostic
Agent Skills spec (agentskills.io: frontmatter `name` matching the directory +
keyword-rich `description`; body < 500 lines). Publishing needs the repo public
on GitHub, but skills.sh does not crawl: a skill appears in its directory via
anonymous install telemetry, i.e. only after someone runs
`npx skills add <owner/repo>`, and ranks by install count. The skill teaches any
coding agent the CLI workflow and rules; it must never assume a specific agent.

---

### `kalamu open`

Starts local server and opens browser UI.

Example:

```bash
kalamu open
```

Options:

```bash
kalamu open --port 4242
kalamu open --no-browser
kalamu open --file .kalamu/outline.jsonl
```

Expected behaviour:

1. Detect project root or use current working directory.
2. Ensure `.kalamu/outline.jsonl` exists. (Amended 2026-07-13.) When no
   `.kalamu/` exists anywhere up the tree and the run is interactive (TTY),
   `open` first asks "No Kalamu project here — initialise `<cwd>`? [Y/n]" —
   showing the path catches wrong-directory accidents — and on yes runs the
   full `init` flow (tour offer, agent docs, skill offer) before serving; on
   no it exits without creating anything. When the directory additionally has
   no repo marker (see the `init` guard above), the question becomes "This
   doesn't look like a code repository — initialise Kalamu in `<cwd>` anyway?
   [y/N]" with the default flipped to no — one question either way, never two.
   Non-TTY runs keep the silent ensure-exists behaviour and are never
   prompted.
3. Start local HTTP server on `127.0.0.1`.
4. Serve prebuilt web app assets.
5. Expose API endpoints for reading/writing nodes.
6. Watch the JSONL file and push changes to the UI (see [Concurrency](#concurrency)).
7. Open browser unless `--no-browser` is passed.

The browser never reads/writes files directly. The local server owns file access.

While running, `open` writes a PID lock at `.kalamu/server.lock` (`{pid, port}`, JSON) so `kalamu stop` can find and stop it from a different terminal; graceful shutdown (`SIGINT`/`SIGTERM`) removes the lock. `.kalamu/*.lock` is already a `kalamu init` gitignore entry (view state, never canonical).

---

### `kalamu stop`

Stops a server left running in a terminal tab nobody remembers, without needing to know which tab. From a project directory:

1. If this project has a live `.kalamu/server.lock`, stop that process (`SIGTERM`, then a short poll) and remove the lock. A lock whose pid is no longer alive is stale — clean it up silently and report nothing running.
2. Otherwise, if a foreground `kalamu hub` has a live lock at `~/.kalamu/hub.lock`, stop that instead — a project with no standalone server may still be served by a hub.
3. A launchd-installed hub is left untouched (`kalamu hub uninstall` is the correct way to stop that one — `KeepAlive` would just relaunch it); `stop` says so instead of sending a signal.
4. Otherwise, report that nothing was found running.

`kalamu hub` writes the same kind of lock at `~/.kalamu/hub.lock` while running in the foreground (not when launchd-managed — see above).

---

### `kalamu list`

Lists outline nodes.

Default output should be human-readable.

Useful options:

```bash
kalamu list --tasks
kalamu list --open
kalamu list --done
kalamu list --started
kalamu list --blocked
kalamu list --tag <tag>
kalamu list --assignee <human|agent>
kalamu list --created-by <human|agent>
kalamu list --discussions
kalamu list --depth 2
kalamu list --format json
```

`--blocked` lists everything carrying at least one blocker — tasks and
discussions alike (key decision 16, amended 2026-08-10).

MVP options:

```bash
kalamu list
kalamu list --tasks
kalamu list --open
kalamu list --tag <tag>
kalamu list --format json
```

Example text output:

```text
n_001  • Auth improvements
n_002    • SSO
n_003      ☐ p2 Investigate WorkOS org mapping #research
n_004      ☐ Add SAML config screen
n_005    • Login UX
n_006      ☐ p1 Fix password reset redirect
```

Done task:

```text
n_007      ☑ Add login tests
```

Handed-off task:

```text
n_008      ☐ Add audit logs → backlog:backlog/tasks/add-audit-logs.md
```

Assigned task (`@human` or `@agent`):

```text
n_009      ☐ Write launch blog post #publishing @human
```

Discussion (open `?`, done `✓`):

```text
n_010      ? p2 WorkOS or Auth0 for SSO
n_011      ✓ Settled: auth stays cookie-based
```

---

### `kalamu show <id>`

Shows a node.

MVP options:

```bash
kalamu show <id>
kalamu show <id> --children
kalamu show <id> --format json
```

Later:

```bash
kalamu show <id> --depth 3
kalamu show <id> --format markdown
```

---

### `kalamu add`

Adds a node.

Examples:

```bash
kalamu add --kind bullet --text "Auth improvements"
kalamu add --parent n_001 --kind task --text "Add password reset"
kalamu add --parent n_001 --kind task --text "Fix upload crash" --p 1
```

Options:

```bash
--parent <id>
--kind bullet|task|discussion
--text <text>
--p <1-3>
--tag <tag>
--assign <human|agent>
--by <human|agent>
--blocked-by <id>
--after <id>
--before <id>
--format json
```

`--tag` is repeatable and appends the `#tag` token to the text (tags live inline in text). `--assign human` marks a task as the developer's own (excluded from `kalamu next`); `--assign agent` explicitly claims it for agents.

`--by` overrides the resolved `createdBy` (key decision 15) — needed only when the automatic resolution would be wrong, e.g. a human driving `kalamu add` from inside a script. `--blocked-by` is repeatable and records blockers at creation time, equivalent to a follow-up `kalamu block`; it applies to tasks and discussions alike.

If `--parent` is omitted, add as top-level.

If `--kind` is omitted, default to `bullet`.

If neither `--after` nor `--before` is given, append as last sibling.

If priority is omitted for a task, do not write priority; treat it as default `2`.

Return the created ID.

Example text output:

```text
Created n_009
```

Example JSON output:

```json
{"id":"n_009"}
```

---

### `kalamu update <id>`

Updates a node.

Examples:

```bash
kalamu update n_009 --text "Add rate limiting to login endpoint"
kalamu update n_009 --kind task
kalamu update n_009 --p 1
kalamu update n_009 --p default
```

Options:

```bash
--text <text>
--kind bullet|task|discussion
--p <1-3|default>
--add-tag <tag>
--remove-tag <tag>
--assign <human|agent|none>
--by <human|agent>
```

`--p default` removes the stored priority (reverting to implicit `p2`).

`--by` corrects recorded authorship (key decision 15) — `human` clears the
field back to the unstored default, `agent` stores it. Unlike `add`, `update`
never resolves an actor on its own: provenance records who wrote the node, so
an ordinary edit must not rewrite it.

`--p 1-3` on a bullet also converts it to a task (see the `priority` field), unless `--kind` is given in the same call.

`--add-tag` and `--remove-tag` are repeatable text surgery: add appends the `#tag` token, remove strips the token(s) from the text. `--assign` sets the assignee; `--assign none` clears it back to unassigned.

Converting a `task` back to `bullet` preserves `doneAt` and `priority`. They are inert on bullets and are restored if the node is converted back to a task.

Validation:

* Do not allow priority outside 1–3.
* Do not allow unknown kind.

---

### `kalamu move <id>`

Moves a node.

Examples:

```bash
kalamu move n_009 --parent n_001
kalamu move n_009 --parent n_001 --after n_002
kalamu move n_009 --parent n_001 --before n_004
```

Options:

```bash
--parent <id>
--after <id>
--before <id>
```

Rules:

* Cannot move node under itself.
* Cannot move node under its own descendant.
* Must preserve children — the whole subtree block moves with the node.
* If neither `--after` nor `--before` is given, append as last child of the new parent.

---

### `kalamu delete <id>`

Deletes a node.

Examples:

```bash
kalamu delete n_009
kalamu delete n_002 --recursive
```

Rules:

* A leaf node is deleted immediately.
* A node with children is refused unless `--recursive` is passed.
* `--recursive` deletes the entire subtree.
* Every deleted ID is removed from any `blockedBy` array that references it, so a delete can never leave a dangling blocker. A node whose `blockedBy` empties as a result drops the field entirely.

Example output:

```text
Deleted n_002 (3 nodes)
```

---

### `kalamu done <id>`

Marks an item done.

```bash
kalamu done n_003
```

Sets:

```ts
doneAt = now
```

Valid for all kinds, with different meanings. On a **task** it is a state
change with full semantics (excluded from `next`, closes its umbrella, removed
by `clean`). On a **bullet** it is strikethrough styling plus cleanup: a done
bullet never gates its descendants' eligibility for `next`, but `clean`
removes it and its entire subtree. Bullets stay non-work-items regardless of
`doneAt`. On a **discussion** it means the conversation happened: like a done
bullet it never closes its umbrella for queue eligibility, but `clean` removes
it and its entire subtree.

Potential option later (not MVP):

```bash
kalamu done n_003 --cascade
```

---

### `kalamu reopen <id>`

Reopens a task.

```bash
kalamu reopen n_003
```

Sets:

```ts
doneAt = null
```

---

### `kalamu search <query>`

Searches node text.

MVP:

```bash
kalamu search <query>
kalamu search <query> --format json
```

Later:

```bash
kalamu search "login" --tasks
kalamu search "auth" --open
```

---

### `kalamu next`

Returns the next task for an agent.

Algorithm:

```ts
const closedAncestor = (n: KalamuNode) =>
  ancestors(n).some(a => a.kind === "task" && a.doneAt !== null);

const eligible = nodes.filter(n =>
  n.kind === "task" &&
  n.text.trim() !== "" &&
  n.doneAt === null &&
  n.assignee !== "human" &&
  !closedAncestor(n)
);

sort by:
  priority ascending, default 2 (p1 first)
  outline order ascending
```

Flags:

```bash
kalamu next --under <id>           # only consider tasks inside this node's subtree
kalamu next --limit <n> | --all    # batch mode: the queue in next-order
kalamu next --discussion           # queue discussions instead of tasks: same sort, same
                                   # output shapes; open, unblocked discussions with no
                                   # closed task ancestor (assignee/startedAt are inert
                                   # on discussions; blockers are not)
```

Example:

```bash
kalamu next
```

Text output — the task, its ancestor path, and its own subtree (never siblings),
so an agent gets full context in one call:

```text
n_006  ☐ p1 Fix password reset redirect
Path: Auth improvements > Login UX
  ☐ Sub step to reproduce first  (n_007)
Reason: highest-priority open task; tie-breaker: outline order
```

JSON output:

```bash
kalamu next --format json
```

```json
{
  "id": "n_006",
  "text": "Fix password reset redirect",
  "priority": 1,
  "path": ["Auth improvements", "Login UX"],
  "ancestors": [
    { "id": "n_001", "text": "Auth improvements", "kind": "bullet" },
    { "id": "n_004", "text": "Login UX", "kind": "bullet" }
  ],
  "descendants": [ /* the task's subtree, pre-order, full nodes */ ],
  "reason": "highest-priority open task; tie-breaker: outline order"
}
```

`ancestors` is root-first (direct chain only — no siblings); `descendants` is
the task's own subtree. Batch mode (`--limit`/`--all`) keeps its lighter
per-entry shape (`id`, `text`, `priority`, `path`).

When no task is eligible, exit with a non-zero status and output `{"id": null}` in JSON mode so agents can detect "nothing to do" deterministically.

---

### `kalamu clean`

Deletes done items and blank nodes from the outline.

```bash
kalamu clean
kalamu clean --dry-run
kalamu clean --format json
```

Rules:

* Removes every done node with its entire subtree, regardless of whether it is a task, discussion, or bullet. This cleanup behavior is separate from queue eligibility: before cleanup, a done bullet or discussion does not close its umbrella for `next`.
* Removes blank nodes (whitespace-only text, any kind) only when they have no surviving children. Blank nodes are structural, so they stay while real content beneath them survives; chains of blank nodes collapse in one pass (children are decided before parents).
* `--dry-run` lists what would be deleted without writing.

Example output:

```text
Deleted 6 node(s) (3 done task(s), 1 done bullet(s), 1 blank node(s))
```

JSON:

```json
{"deleted": 6, "doneTasks": 3, "doneBullets": 1, "doneDiscussions": 0, "blankNodes": 1, "ids": ["n_007", "n_008", "n_009", "n_010", "n_011", "n_012"]}
```

---

### `kalamu validate`

Validates the JSONL file.

Check:

* Every line is valid JSON.
* Every node has required fields.
* IDs are unique.
* `parentId` is either `null` or points to an existing node.
* No cycles.
* `kind` is `bullet`, `task`, or `discussion`.
* `doneAt` is either `null` or a valid ISO timestamp.
* `priority`, if present, is an integer 1–3 (legacy `4`/`5` values are clamped to `3` on read and rewritten on the next write).
* `assignee`, if present, is `"human"` or `"agent"` and the node is not a discussion (setting one is rejected at the operation level; a stale value inherited from a past life as a task is inert).
* `createdBy`, if present, is `"agent"` — `"human"` is the default and is never written.
* `startedAt`, if present, is a valid ISO timestamp.
* `blockedBy`, if present, is a non-empty array of unique IDs that all point to existing nodes, never containing the node's own ID.
* No blocker cycles.

Unknown node fields are NOT an error: readers must preserve fields they don't recognize through parse → operate → write, so an older build can never erase what a newer one wrote. Writers emit unknown fields after the known keys, sorted by name.

Warn (not error):

* File is not in pre-order traversal (the next write will normalize it).

Example:

```bash
kalamu validate
```

Output:

```text
Valid: 8 nodes
```

JSON:

```bash
kalamu validate --format json
```

```json
{
  "valid": true,
  "nodes": 8,
  "errors": [],
  "warnings": []
}
```

---

## Web UI

Build a browser-based UI launched by:

```bash
kalamu open
```

The web app should be prebuilt and served by the local CLI/server.

Use:

* Svelte + Vite
* TypeScript
* Local HTTP API
* Server-Sent Events for live updates (required, not optional — see [Concurrency](#concurrency))

Avoid requiring the user's repo to contain the web source code.

The installed Kalamu package should contain:

```text
CLI/server code
compiled web assets
core data/model code
```

The user's project repo should contain only:

```text
.kalamu/outline.jsonl
.kalamu/meta.json
```

---

## UI principles

The UI should feel like Workflowy:

* Infinite nested bullets
* Keyboard-first editing
* Easy indent/outdent
* Easy move up/down
* Fast creation of sibling and child nodes
* Collapsible parents — collapsed state persists across sessions (via `ui-state.json`) but never touches the outline file; a collapsed node shows a visual hint that it has hidden children (e.g. ringed bullet, Workflowy-style)
* Fast deletion (backspace on an empty node deletes it, Workflowy-style)
* Undo/redo for all structural operations (in-session undo stack is sufficient for MVP)
* Ability to toggle bullet/task
* Done tasks greyed out and struck through
* Priority visible only when useful, as a badge at the START of the row (scannable column)
* Tags as small coloured chips rendered IN PLACE within the text (raw `#token` text while the node is focused)
* URLs recognised in text (`http://`/`https://` schemes only — no bare-domain guessing) render underlined and clickable, opening in a new tab; while the node is focused the URL is raw editable text, like tags. Trailing sentence punctuation is not part of the link, and a `#fragment` inside a URL never becomes a tag chip
* Assigned tasks visibly distinct: a small user icon marks human-assigned tasks, a robot icon marks agent-assigned ones; unassigned tasks show neither
* Discussions marked with a speech-bubble glyph in place of the checkbox (clicking it toggles done, like a task's checkbox)
* Every unfocused node shows a subtle copy affordance at the end of its text. A normal click copies the same agent-context block as Cmd/Ctrl+C; Mod-click copies only the raw node text, like Cmd/Ctrl+Shift+C. Both actions are uniform across node kinds
* Modifier chords make the whole row a mouse target for the two operations whose own affordance is small or absent: **Mod+click** toggles collapse (the chevron alone is a 10px target), **Alt+click** zooms in. One modifier each, so neither is a two-hand stretch; holding both is a slip, not a third gesture, and does nothing. Shift is left to the browser throughout, so Shift+click still extends a native text selection. The chords are claimed in the capture phase, so the chevron, glyph, priority badge, tag chips and inline links never fire their own action as well — the copy affordance is the one exemption, since Mod+click there is already its own action
* A blocked node carries a **Blocked** badge, and the badge is the way to what it waits on: with one open blocker it jumps straight there, with several it opens a menu of them first. The jump is the app's one reveal primitive — it drops a zoom the target sits outside of, unfolds the ancestors hiding it, and reprieves it from the active filters (`hideDone` included) until those filters next change. Nothing is restored afterwards: the zoom change is a history entry, so the way back is browser Back
* Every node carries its creation time in a meta row beneath it, as a relative age that keeps aging in a window left open (one shared clock, not a timer per row), with the exact local timestamp on hover. It shares that row with the progress bar, and the row is a fixed height whether or not either is showing, so nothing ever reflows
* Zoom (Workflowy-style): any node can become the temporary root — only its subtree is displayed, with a sticky breadcrumb trail above the outline (project name › ancestors › current node) whose crumbs are clickable to change the zoom level. The zoom target lives in the URL hash (`#z=<id>`), so reload restores it and browser Back unwinds it; zoom is per-tab view state, never in `ui-state.json` or the outline file. Operations that would move a node outside the zoomed subtree (indent/outdent/move on the zoom root, outdenting its direct children) are inert; Enter on the zoom root creates a child rather than an invisible sibling; deleting the zoom root lands the zoom on its parent; Escape (when not editing, once no tag filter is active) zooms fully out
* Minimal visual clutter
* Light/dark theme follows the system by default; an explicit switcher (navbar button, or the palette's "Activate dark/light mode") overrides it, persisted in the browser's localStorage — per-browser view state, never in the repo

Undo is a hard MVP requirement, not polish: a keyboard-first tool that moves and deletes subtrees without undo loses user data and trust.

### Visual representation

Bullet:

```text
• Auth improvements
```

Task:

```text
☐ Fix password reset redirect
```

Done task:

```text
☑ Fix password reset redirect
```

High-priority task (badge leads the row so priorities align in a scannable column):

```text
☐ p1 Fix password reset redirect
```

Default priority `p2` should generally be hidden.

Handed-off task:

```text
☐ Add audit logs → backlog
```

Discussion (speech-bubble glyph in the UI; `?` in CLI output, `✓` when done):

```text
🗩 WorkOS or Auth0 for SSO   [copy icon]
```

Tagged task (chip renders in place, mid-sentence when the token sits mid-sentence):

```text
☐ Build a new [feature] to do xyz
```

Assigned task (user icon for human, robot icon for agent, rendered after the text):

```text
☐ Write launch blog post  [user icon]
☐ Migrate the config loader  [robot icon]
```

---

## Keyboard shortcuts

Suggested MVP keyboard shortcuts:

```text
Enter                    create new sibling; on an EMPTY node it cycles the kind
                         instead (never creates below an empty one; outdenting an
                         empty node is Shift+Tab's job)
Tab                      indent
Shift+Tab                outdent
ArrowUp/ArrowDown        move focus (goal column preserved: the caret keeps aiming
                         for its remembered column across consecutive vertical moves,
                         clamped to line length; any other key resets it)
Cmd/Ctrl+ArrowUp         move node up
Cmd/Ctrl+ArrowDown       move node down
Cmd/Ctrl+Enter           mark item done/reopen — visual-only strikethrough on
                         bullets (not Cmd+D — it works while editing
                         but falls through to the browser's bookmark dialog when
                         no node is focused)
Alt/Option+Enter         cycle kind: bullet → task → discussion → bullet
Cmd/Ctrl+K               open the command palette — a leader-key menu (see
                         [Command palette](#command-palette))
Cmd/Ctrl+.               toggle collapse/expand
Cmd/Ctrl+Shift+ArrowUp   collapse the parent — the caret jumps up to it (inert on
                         root-level nodes and on the zoom root)
Cmd/Ctrl+Shift+ArrowDown expand the children — the caret jumps down into the first
                         visible child; on an already-expanded node it is pure
                         descent, so repeated presses walk down the tree (inert
                         on leaves)
Cmd/Ctrl+Shift+.         zoom in on the focused item (only its subtree displayed)
Cmd/Ctrl+Shift+,         zoom out one level (Escape when not editing zooms all
                         the way out, after clearing any active tag filter)
Backspace (empty node)   delete node
Backspace (caret at 0)   clear the node's priority (tags are plain text — backspace them directly)
Cmd/Ctrl+Shift+Backspace delete node with subtree (undoable)
Cmd/Ctrl+C               (nothing selected) copy an agent-context block: a
                         `Kalamu {kind} ID: {id}` header, then the direct
                         ancestor path, the item and its complete subtree as
                         nested markdown, excluding every sibling branch;
                         uniform across kinds
Cmd/Ctrl+Shift+C         copy only the focused node's raw text — no id, kind,
                         markdown marker or context wrapper; uniform across kinds
Cmd/Ctrl+/               open keyboard cheat sheet ("?" also opens it when not editing)
Cmd/Ctrl+Z               undo
Cmd/Ctrl+Shift+Z         redo
```

Modifier choice is deliberate: Alt/Option+Enter is the sole Alt keyboard
shortcut. Enter is not a character, so macOS Option-key character substitution
does not apply, and the focused editor handles and prevents the chord before
contenteditable can act. Configurable tiling window managers may still claim it
globally before the browser receives it. Other Alt/Option keyboard shortcuts
remain excluded (Alt as a *mouse* chord is unaffected), as do
Cmd+M / Cmd+1..9 / Cmd+Shift+3-5 (OS- or browser-reserved). Node metadata that
previously had Alt shortcuts (priority, assignee) lives in the command palette.

Need not implement all shortcuts in first pass, but structure the code so they can be added cleanly.

---

## Command palette

Cmd/Ctrl+K opens the command palette — including while a node is being edited.
(Amended 2026-08-10.) It is a **leader-key menu** in the style of
[LeaderKey](https://github.com/mikker/LeaderKey), not a search box: a static
panel listing every action alongside the single key that triggers it. There is
no text input, no filtering, no cursor to move — pressing an action's key runs
it immediately, so every action is a short memorizable sequence (`Cmd+K d`
toggles done, `Cmd+K p 1` sets p1) that can never clash with a browser or OS
shortcut, because only the opening chord involves a modifier. The panel is
self-documenting: keys are printed next to their labels, so nothing has to be
memorized before it can be used.

The palette acts on the last-focused node and offers, at the root level:

```text
1-9  Open project n       hub mode only: switch to the n-th sidebar project
                          (registry order — the same order that numbers the
                          sidebar), each row
                          showing the project's name and colour swatch; only
                          as many digit rows as there are projects render, and
                          none in standalone mode
a    Assign ->            submenu: a Agent / h Human / u Unassigned, current
                          value marked; selecting sets the task's assignee
                          (Unassigned clears it); choosing Human or Agent on a
                          bullet converts it to a task and assigns it; closes
b    Block ->             submenu: a Add block -> candidate nodes to record in
                          `blockedBy`, selecting adds the blocker, closes ·
                          r Remove block -> the node's current blockers, plus
                          "Remove all blockers" (on key `a`) when there is more
                          than one; selecting removes that entry, closes
c    Copy ->              submenu: c CLI command -> (one level deeper:
                          ready-to-run CLI commands for this node with its real
                          (server) id filled in — show --children always; done
                          or reopen (by state); add-child-task; delete
                          (--recursive when the node has children)) · p Prompt —
                          the node's ancestor path and subtree, for an agent
                          chat (same as Mod+C) · t Text — the node's own text
                          alone (same as Mod+Shift+C). Each copies to the
                          clipboard, toasts, and closes with focus restore.
d    Toggle done          marks the task done / reopens it, closes
i    CLI reference        opens the CLI commands sheet
k    Keyboard cheat sheet opens the keyboard cheat sheet
l    Labels ->            submenu: every #tag in the outline, checkmark if the
                          node has it; selecting toggles the #token in the
                          node's text (tags stay inline — key decision 7);
                          stays open for multi-toggle
p    Priority ->          submenu: 1-3 set the priority (2 = back to default),
                          current level marked
r    Redo                 replays the last undone change (same as Mod+Shift+Z);
                          disabled with nothing to redo
s    Start / End          claims the task (`startedAt`) or releases the claim —
                          the label shows whichever applies; closes
t    Kind ->              submenu: b Bullet / d Discussion / t Task, current
                          kind marked; selecting sets that kind outright — the
                          same three Alt/Option+Enter cycles through — closes
u    Undo                 walks the document back one change (same as Mod+Z);
                          disabled with nothing to undo
v    View ->              submenu of toggles whose labels reflect the current
                          state: h Hide/show done · m Enter/leave compact
                          mode · t Activate dark/light mode; each closes
x    Clean up             deletes every done task with its subtree, plus done
                          bullets and blank nodes (same as `kalamu clean`),
                          applied through the UI's undo stack so it is undoable
                          in-session; toasts the result ("Deleted 4 nodes
                          (3 done tasks)" / "Nothing to clean."), closes
z    Zoom ->              submenu: i Zoom in — zooms the view to this node
                          (same as Mod+Shift+.), disabled when it is already the
                          zoom root, closes with focus in the new root · o Zoom
                          out — leaves one zoom level (same as Mod+Shift+,),
                          needs no target, only a zoom to leave, closes with
                          focus on the node just left
←    Collapse children    folds the node's own children in place; closes with
                          the caret where it was (Cmd/Ctrl+. still toggles)
→    Expand children      unfolds the node's children and moves the caret into
                          the first visible child (same as
                          Cmd/Ctrl+Shift+ArrowDown); closes with focus on that
                          CHILD
↑    Collapse parent      folds the current node's parent and moves the caret
                          to it (same as Cmd/Ctrl+Shift+ArrowUp); closes with
                          focus on the PARENT, not the node it acted on
```

The action list is fixed: every non-digit item always renders, on a stable key
and in key order — digits, then the letters alphabetically, then the
punctuation and arrow rows. Only the project digit rows vary, with the hub
registry. Items that don't apply are greyed out and disabled rather than
hidden — with no node focused, every node-targeting action (`c d p a l t s b
← → ↑`) is disabled (the view, clean, undo/redo, zoom and sheet items
need no target and are always enabled — Clean up with nothing to clean just
toasts "Nothing to clean."). On a bullet, Start/End and Block are disabled
(bullets are structure, not work — key decision 16), while Assign is enabled:
choosing Human or Agent converts the bullet to a task and assigns it atomically;
choosing Unassigned leaves the bullet unchanged. Priority also applies (picking
1 or 3 converts the bullet into a task, exactly like `--p` on the CLI; 2 clears
back to default without converting), and Toggle done works on bullets as a
visual-only strikethrough (Copy stays enabled, with task-only commands omitted
from the CLI submenu; done/reopen appear for bullets too). On a
discussion, Assign and Start/End are disabled (discussions are never assigned
and never claimed — key decision 12); Priority, Toggle done, Block, Kind and
Copy all apply. The fold actions (`← → ↑`) apply to every kind (they are
structural, not metadata) but carry their own disabled cases: Collapse children
on leaves and on an already-folded node, Expand children on leaves (nothing
beneath to fold), Collapse parent on root-level nodes and on the zoom root
(nothing rendered above to fold). Remove block is disabled while the node has no
blockers, Start on a done task, Undo and Redo on an empty stack, Zoom in on the
node already zoomed to and Zoom out when the view isn't zoomed. Disabled items
don't respond to keys or clicks. The CLI
commands sheet mirrors `kalamu --help` — command names with one-line
descriptions — as a reference for the developer; agents use `--help` itself.

Key rules:

* A key acts immediately — no query, no Enter-to-confirm. At the root, digits
  belong exclusively to project switching.
* Submenus over dynamic lists (labels, block candidates, blockers, CLI
  commands) assign keys automatically: `1`-`9`, then letters in home-row order
  (`a s d f g h j k l`, then `q w e r t y u i o p`, then `z x c v b n m`),
  skipping any key the level reserves (`a` at the unblock level). Items past
  the key supply remain reachable by click and scroll — in practice only an
  enormous tag or candidate set gets there.
* Rows are also clickable, exactly as before.
* Esc steps back exactly one level — Copy CLI command → Copy → root — and
  closes at the top; Backspace does the same. Closing returns focus to the node
  the palette was acting on, except where the action itself moved the caret
  (Expand children, Collapse parent, both zooms).
* When focus falls to the body while the window stays focused (Tab out, or an
  extension that blurs inputs on Esc — e.g. Vimium — eating the keypress before
  the page sees it), the palette treats the blur as Esc: step back and refocus
  at a sublevel, close at the root. Esc therefore behaves identically with or
  without such an extension. Focus moving to a real element outside the palette
  closes it without refocusing; switching apps does not close it.
* Label toggles keep the palette open; every other action closes it.
* The direct shortcuts that duplicate palette actions (Mod+Enter, Mod+.,
  Alt+Enter, Mod+Shift+↑/↓, Mod+Shift+H, Mod+Shift+./,, Mod+C,
  Mod+Shift+C, Mod+Z, Mod+Shift+Z) remain for now, but the leader sequences are
  the canonical path — new actions get a leader key first and a direct shortcut
  only if proven necessary. Mod+Shift+1-9 project switching is already
  retired (2026-08-10): `⌘K n` replaced it, ending the clash with macOS's
  Mod+Shift+3/4/5 screenshot shortcuts.

---

## Priority parsing in UI

The UI should cleverly parse priority from text.

If user types:

```text
Fix broken upload p1
```

and the node is a task (or discussion — priority applies without converting the kind), store:

```json
"text": "Fix broken upload",
"priority": 1
```

Do not store `p1` in text.

Regex should be conservative:

```regex
/(?:^|\s)p([1-3])(?:\s|$)/i
```

Rules:

* `p1` to `p3` are valid.
* `p2` means default; omit priority from stored JSON unless explicitly choosing to store it.
* Do not parse `p4`, `p10`, `p99`, `P256`, etc.
* Do not parse inside longer words.
* A priority token always OVERRIDES an existing stored priority (typing `p1` on a `p3` task makes it `p1`).
* Parse timing: when the user types a space, parse ONLY the just-completed token immediately before the caret (instant badge feedback, no whole-text rescans per keystroke). Commit-time parsing (Enter/blur) remains as the backstop for pasted or mid-line-edited text. This applies to `pN` and `@human`/`@agent` tokens; `#tags` stay in the text by design.

Unlike tags, priority is NOT stored in text — `p1` is metadata, not prose, and it drives the agent-facing `next` sort, so it stays a first-class field. Rendering gives it text-like ergonomics:

* The priority badge renders at the START of the row (after the checkbox, before the text) so priorities line up in a scannable column regardless of text length. Every row — bullets included — reserves the same badge column, so text aligns vertically across kinds.
* Backspace with the caret at position 0 of the node text clears the priority (reverts to default).
* Clicking the badge opens a dropdown (p1–p3; picking p2/medium clears back to default — there is no separate clear entry); rows at default priority show a subtle ghost badge on row hover/focus that opens the same dropdown. On bullets the badge is always the ghost (stored priorities are inert there); picking p1/p3 from a bullet's dropdown converts it into a task, like `--p` on the CLI.

---

## Tags

Tags are lightweight labels for scanning the outline and, later, filtering it. They are deliberately not a taxonomy: no tag CRUD commands, no tag registry, no required setup. A tag exists because text mentions it, and disappears when no text does.

### Storage and naming

* A tag IS its inline `#token` in the node text: `Build a new #feature to do xyz`. The token can sit anywhere in the sentence and double as a word of it.
* There is no stored `tags` field; the tag set is derived by scanning text for whole-word `#[a-z0-9][a-z0-9-]*` tokens. Derived names are lowercased for filtering and colour lookup.
* Editing or deleting a tag is ordinary text editing — no dedicated removal UI or commands are needed.

### Colour

Every tag gets a colour with zero configuration:

* Hash the tag name deterministically into a curated palette of ~12 hues that are distinguishable from each other and readable in both light and dark themes.
* The same tag therefore renders the same colour everywhere, forever, on every machine — no state needed.
* The developer normally sets nothing — hash-derived colours are the default and cover almost all cases.
* Overrides live in `meta.json` under `"tags"`, mapping tag name to a hex colour. Overrides are for taste, not correctness; nothing breaks without them.
* Overrides are set from the UI (see below) and persisted by the server into `meta.json`. The file stays canonical and hand-editable — the picker is just a friendly way to write it.

### UI behaviour

* An UNFOCUSED node renders each `#token` as a small coloured chip in place — the chip occupies the token's position in the sentence. The FOCUSED node shows raw text (`#feature` as plain characters), so the caret, backspace, and selection treat tags like any other text. Committing/blurring re-renders chips.
* Token recognition regex (whole words only, never inside longer words like `issue#42`):

  ```regex
  /(?:^|\s)#([a-z0-9][a-z0-9-]*)(?=\s|$)/i
  ```

* `@human` and `@agent` are extracted tokens (assignment is state, not prose): typing one in a task's text sets `assignee` and removes the token:

  ```regex
  /(?:^|\s)@(human|agent)(?=\s|$)/i
  ```

* Typing a bare `@` in the editor opens a small assign dropdown at the caret — the same interaction shape as a slash-command menu. It offers **Human** (user icon) and **Agent** (robot icon); continuing to type filters the two, Enter/click assigns (removing the typed `@…` from the text), Esc or a non-matching word dismisses it and the text stays as typed.
* Typing `#` in the editor likewise opens a tag combobox at the caret listing the outline's existing tags (each with its chip colour), filtered as you type. Enter/click completes the `#token` in the text — a pure text edit; the token stays, becoming a chip on blur (key decision 7). Esc dismisses it, and typing a tag that matches nothing simply continues as typed — new tags need no ceremony, they exist by being mentioned. No existing tags, no combobox.

* Clicking a chip (in an unfocused node) opens a small popover showing the ~12 palette swatches plus a "default" option. Picking a swatch writes the override to `meta.json` via the server; "default" clears it, reverting to the hash-derived colour. Clicking non-chip text focuses the node with the caret mapped to the equivalent source position.
* The popover also offers **Filter by #tag**: the outline shows only matching nodes, their ancestors (structure), and their descendants (a tagged umbrella includes its contents). A dismissible pill above the outline shows the active filter; clicking it (or Esc outside editing) clears it. One tag at a time; session-only — never persisted to `ui-state.json`.

### Assignment in the UI

* Assigned tasks show a subtle icon after the text — a user icon for `"human"`, a robot icon for `"agent"` — so they scan differently from unassigned tasks. The icons match the @ dropdown's.
* Assignment is set from the @ dropdown, `@human`/`@agent` tokens, or the palette's Assign submenu (no dedicated shortcut — Cmd+M is OS-reserved). The palette also offers Assign on a bullet; choosing Human or Agent promotes it to a task and assigns it in the same operation. Discussions never offer Assign.

---

## Architecture

Recommended repo structure:

```text
kalamu/
  packages/
    core/
      src/
        model.ts
        jsonl.ts
        tree.ts
        validate.ts
        operations.ts
    cli/
      src/
        index.ts
        commands/
          init.ts
          open.ts
          list.ts
          show.ts
          add.ts
          update.ts
          move.ts
          delete.ts
          done.ts
          reopen.ts
          search.ts
          next.ts
          validate.ts
        server.ts
    web/
      src/
        App.svelte
        components/
        stores/
        api.ts
      vite.config.ts
```

Use a monorepo if helpful.

Stack (decided):

* TypeScript throughout
* Node.js ≥ 20; published as a **single** npm package (`kalamu`) so `npx kalamu open` works with nothing installed
* pnpm workspaces internally (`core`, `cli`, `web`); only `cli` is published — it bundles `core` and ships the compiled web assets
* Svelte 5 (runes) + Vite for the web UI
* Hono for the local server (routing, JSON handling, SSE helpers)
* Commander for CLI parsing
* Zod for validation
* chokidar for file watching
* tsup (esbuild) to bundle the CLI so users don't inherit the dependency tree
* Vitest for tests

---

## Local server

The local server should:

* Serve static web app assets
* Read/write `.kalamu/outline.jsonl`
* Provide JSON API endpoints
* Validate operations before writing
* Avoid corrupting the file
* Use atomic writes
* Watch the file and push change events to connected UIs

Suggested API routes:

```http
GET    /api/nodes
PUT    /api/nodes         (replace whole outline; exists for UI undo/redo snapshot-restore; payload fully validated)
GET    /api/nodes/:id
POST   /api/nodes
PATCH  /api/nodes/:id
DELETE /api/nodes/:id
POST   /api/nodes/:id/move
POST   /api/nodes/:id/done
POST   /api/nodes/:id/reopen
POST   /api/nodes/:id/start      (body: {"force": true} to re-claim)
POST   /api/nodes/:id/end
POST   /api/nodes/:id/block      (body: {"by": "n_..."}; 409 on a cycle)
DELETE /api/nodes/:id/block/:byId (omit :byId to clear all blockers)
GET    /api/search?q=...
GET    /api/next
GET    /api/validate
POST   /api/assets        (raw image body; writes content-hashed file to .kalamu/assets/; returns {path, url})
GET    /assets/:file      (serves .kalamu/assets/ files)
GET    /api/meta          (meta.json: version + tag colour overrides)
PUT    /api/tags/:tag     (set or clear a colour override; body: {"color": "#hex" | null})
GET    /api/ui-state
PUT    /api/ui-state      (replace collapse state; body: {"collapsed": ["n_..."]})
GET    /api/events        (SSE stream: outline-changed / meta-changed events)
```

---

## Concurrency

Two writers exist by design: the local server (driven by the UI) and the CLI (driven by agents in a terminal). Without a plan, whichever holds a stale in-memory copy silently clobbers the other's write. This section is a hard requirement, not an option.

Every write — CLI or server — follows this sequence:

1. Read all JSONL nodes; record the file's mtime.
2. Apply the validated operation in memory.
3. Serialize nodes as JSONL in pre-order traversal.
4. Before writing, verify the file's mtime is unchanged.
   * If it changed, re-read the file and re-apply the operation once; if it changed again, fail with a clear error.
5. Write to a temp file in the same directory.
6. Atomic rename over the original.

`meta.json` and `ui-state.json` writes use the same temp-file + atomic-rename pattern (ui-state additionally debounced — it changes on every fold).

The server additionally:

* Watches `.kalamu/outline.jsonl` (chokidar or `fs.watch`).
* Pushes an `outline-changed` event over SSE whenever the file changes on disk (e.g. an agent ran `kalamu done` while the UI is open).
* The UI reloads its state on that event, preserving focus/cursor where possible.

---

## Hub (multi-project dashboard)

Post-MVP. The pain it removes: with N projects, `kalamu open` means N terminal trips and N different addresses. The per-project server was only ever a file gateway (`createServer(paths, webAssetsDir)` is parameterized by a `.kalamu/` directory), so one long-running local process can mount them all. The hub adds **zero** cloud, auth, or database — it is the same local server pattern, once, for everything.

### Project registry

Machine-global file (the first Kalamu file outside a repo):

```text
~/.kalamu/projects.json
```

Shape:

```json
{
  "version": 1,
  "projects": [
    {
      "slug": "kalamu",
      "path": "/Users/dev/repos/kalamu",
      "registeredAt": "2026-07-12T00:00:00.000Z",
      "lastSeenAt": "2026-07-12T09:30:00.000Z"
    }
  ]
}
```

Rules:

* Every CLI command that resolves a project (`init`, `open`, `add`, `next`, …) upserts that project's entry — registration is a side effect of use, never a setup step. Existing entry: touch `lastSeenAt` only.
* Entries whose `path` no longer contains `.kalamu/outline.jsonl` are pruned silently on read. The outline file — not the bare directory — is the project test everywhere (`findRoot` included), so the machine-global `~/.kalamu` (registry, hub log) can never make the home directory masquerade as a project.
* Writes use the same temp-file + atomic-rename pattern as everything else. Registry failures must never break the command that triggered them — a broken registry degrades the hub, not the CLI.
* The registry is plumbing, not data: deleting it loses nothing except the sidebar list (plus slug assignments, name/colour overrides, and the manual sidebar order), which repopulates on use.

### Slugs

The hub identifies a project in URLs by a slug, not an opaque ID:

* Derived at **first registration** from `package.json` `name` if present, else the project directory's basename — the same derivation the UI title already uses.
* Normalization: strip a leading `@scope/`, lowercase, replace runs of characters outside `[a-z0-9-]` with `-`, trim leading/trailing dashes. Empty result falls back to `project`.
* Collision with a different path: append the first free numeric suffix (`api`, `api-2`, `api-3`).
* **Stable once assigned.** Renaming `package.json` or the directory later does not change an existing slug — bookmarks and open tabs keep working. The sidebar's *display name* is recomputed live (current `projectName()` logic) unless the user has renamed the project in the hub; the slug is route identity only.

### Renaming

A project can be renamed from the hub sidebar (inline edit). The rename sets an optional `name` field on the project's registry entry — a display-name override used by the sidebar and by the project's own header (`kalamu | <name>`) wherever the hub serves it. It never changes the slug, the project's `package.json`, or anything in the repo. Committing a blank name clears the override, reverting to the derived name. Like everything in the registry, overrides are plumbing: deleting `~/.kalamu/projects.json` loses them.

### `kalamu hub`

```bash
kalamu hub                # foreground server on 127.0.0.1:4400
kalamu hub --port 4500
kalamu hub --no-browser
kalamu hub list           # list registered project slugs and paths
kalamu hub forget <slug>  # remove one project from the sidebar; repo data is untouched
kalamu hub install        # launchd user agent (macOS): start at login
kalamu hub uninstall
kalamu restart            # restart the installed hub (picks up updated code)
kalamu stop              # stop a foreground (non-installed) hub, from another terminal
```

Routes:

```http
GET /api/projects                    (registered projects: slug, display name, path, theme colour, open-task count)
PATCH /api/projects/:slug            (set/clear the display-name and/or theme-colour override, and/or move the project to sidebar position {"index": n}; returns the effective values; 200/400/404)
DELETE /api/projects/:slug           (forget: drop the registry entry, tear down any live instance; 204/404)
ALL /p/:slug/api/*                   (routed into that project's server instance)
GET /p/:slug/assets/*                (same)
GET /                                (hub UI: project sidebar + outline pane)
GET /p/:slug                         (deep link, sidebar pre-selected)
```

Behaviour:

* Per-project server instances are the existing `createServer()` — created lazily on first request for a slug, torn down after an idle period so the hub doesn't hold file watchers for dormant projects.
* The sidebar lists projects in **registry array order** — a manual order, dragged into place row by row in the UI (`PATCH {"index": n}` moves a project to 0-based position n, clamped). New projects register at the end; re-registration touches `lastSeenAt` only and never moves an entry. Recency deliberately does not order the sidebar — a stable order is what keeps the palette's `⌘K 1…9` project digits stable — and only picks which project `GET /` lands on.
* Every project has a **theme colour** so multiple Kalamus are tellable apart at a glance: the sidebar is tinted with the active project's colour and each row carries a swatch. Like tag colours (key decision 7), the colour is the slug hashed into the shared palette — automatic, stable, stored nowhere — until a swatch pick stores an override in the registry (`PATCH {"color": "#rrggbb"}`; blank clears back to derived).
* Removing a project from the sidebar is a **forget**, consistent with the registry being plumbing: the entry is dropped, the project's `.kalamu/` data is untouched, and the next kalamu command run inside the project re-registers it. The UI's per-entry remove affordance and `kalamu hub forget <slug>` both expose this operation without confirmation because it is non-destructive; `kalamu hub list` prints the stable slugs and paths needed to identify entries from the terminal.
* SSE live reload, mtime-checked atomic writes, and undo work unchanged per project; hub, standalone `kalamu open` servers, and CLI agents can all write concurrently because every writer already does mtime-checked atomic writes.
* `kalamu hub install` writes a launchd user agent (macOS first; systemd user unit later) so the hub is always up and `http://localhost:4400` becomes a permanent bookmark — the terminal disappears from the human workflow entirely.
* A launchd-managed hub (installed plist, launchd is the parent process) polls the bundle it was started from (~30s) and exits once a replaced one has settled on disk (mtime changed and ≥10s old, so a mid-write install never counts), letting `KeepAlive` restart it on the new code. Otherwise a CLI update refreshes the web assets (served from disk) while the server process keeps running months-old code. This is a restart, not a self-update — the human still installs updates (key decision 14) — and `kalamu restart` remains the way to force it immediately. A foreground hub never self-exits; it belongs to whoever's terminal it runs in.

### `kalamu open` integration

When a hub is already listening on the hub port, `kalamu open` opens `http://localhost:4400/p/<slug>` instead of starting a standalone server. When no hub answers but the launchd agent is installed (macOS, plist present), `open` wakes it (`launchctl kickstart`, falling back to `bootstrap`) and routes there once it responds — an installed hub is always the destination, never a standalone server. Only when neither applies (or the wake fails, or `--port` opts out) does `open` start a standalone server. Agents are unaffected — the hub exists for the human at the keyboard, and no agent-facing command needs it.

### Discovery

Nothing ever pushes the login item: `init` never offers it and the hub is advertised only by quiet, individually dismissible sticky-footer hints in the UI (dismissals persist per-browser in localStorage, never in the repo). `GET /api/project` carries `platform` and `hubInstalled` (plist existence) so hints appear only where actionable — one hint at a time, chosen randomly among the undismissed:

* Standalone, hub not installed: "Running multiple projects? See a unified view of all your Kalamus by running `kalamu hub`" and (macOS only) "Tired of running `kalamu open`? Keep Kalamu ever-ready with `kalamu hub install`".
* Hub mode, macOS, not installed: "Tired of running `kalamu hub` every time? Keep Kalamu ever-ready with `kalamu hub install`".
* Hub installed: no hints anywhere.

Each hint's command is a click-to-copy chip. Discovery therefore ladders `open` → `hub` (foreground, installs nothing) → `hub install`, each nudge appearing only at the moment it is actionable.

---

## Update checks

(Added 2026-07-13. See key decision 14.) Because none of Kalamu's install paths self-update — `npx` pins the version it first resolved, global installs and the launchd hub sit still until told otherwise — a user can run a months-old binary with no signal. The update check closes that gap: it tells the human a newer version is on npm, and nothing more (Kalamu never self-updates).

**The call.** A single GET to `https://registry.npmjs.org/kalamu/latest`, throttled to about once a day. This is the only outbound request Kalamu makes; it is not analytics and carries no outline data. It is on by default with a one-time notice printed on the first run that performs it.

**Opt-out** (any one disables it): the `KALAMU_NO_UPDATE_CHECK` env var, a `CI` env var (CI is never nagged), or `updateCheck: false` in `~/.kalamu/config.json` — set persistently with `kalamu config update-check off` (and `on` to re-enable; `kalamu config` with no argument prints the current state).

**Best-effort, never in the way.** The latest version is cached in `~/.kalamu/update-check.json` with the attempt timestamp; the displayed comparison always comes from that cache (instant, synchronous), and only a stale cache triggers a network read (short timeout). Offline, a slow or failing registry, a corrupt cache, or an opt-out all degrade to "no update known" — never an exception, never a blocked command. A failed fetch still stamps the timestamp so a flaky registry isn't retried every run.

**Two surfaces, one shared check** (both live in the CLI process; the browser never calls npm):

* **CLI banner.** After a command completes, a human at a TTY sees `kalamu <latest> available (you have <current>) · npm i -g kalamu@latest` on **stderr** — off-stdout so it can never corrupt `--format json`, and TTY-gated so agents and scripts never see it. Long-running `open`/`hub` exit before the banner would print; their sessions are covered by the chip instead.
* **Web/hub chip.** `GET /api/project` reports `version`, `latestVersion`, and `updateAvailable` (comparison served from cache; a throttled refresh warms it at server start and on each poll). The UI shows a quiet, dismissible chip when an update is available; dismissal is keyed to the version in localStorage, so it returns for the next release.

Version comparison is plain `x.y.z`: a pre-release or unparseable version on either side reads as "no update", so a user running a dev build is never nagged.

---

## MVP acceptance criteria

### CLI

The following works in a fresh Git repo:

```bash
kalamu init
kalamu add --kind bullet --text "Auth improvements"
kalamu add --parent n_001 --kind task --text "Fix password reset redirect" --p 1
kalamu list
kalamu next
kalamu done n_002
kalamu validate
```

Expected:

* `.kalamu/outline.jsonl` is created.
* Nodes are stored as JSONL in pre-order traversal.
* Priority is stored only when non-default.
* `kalamu next` returns the lowest-priority-number (most urgent) open task with no closed ancestor task.
* `kalamu done` sets `doneAt`.
* `kalamu validate` passes.

### Web UI

The following works:

```bash
kalamu open
```

Expected:

* Local server starts.
* Browser opens.
* Existing outline renders.
* User can add bullets.
* User can add tasks.
* User can nest nodes.
* User can mark tasks done.
* User can delete a node and undo the deletion.
* User can type `p1` and have priority parsed.
* User can type `#backend` mid-sentence and see it render as an in-place coloured chip once the node loses focus, with the token preserved in the stored text.
* User can click a tag chip, pick a different colour, and see it persisted to `meta.json`.
* User can collapse a parent, restart `kalamu open`, and find it still collapsed — with zero change to `outline.jsonl`.
* User can assign a task to themselves (human) and see `kalamu next` skip it.
* JSONL file updates.
* Running `kalamu done <id>` in a terminal while the UI is open updates the UI without a manual refresh.

### Agent use

An agent should be able to:

```bash
kalamu next --format json
kalamu show <id> --children --format json
kalamu done <id>
kalamu validate
```

without needing to load or understand the full UI.

---

## Implementation order

The outliner UI is the hardest part of this project and its biggest risk. Prove it first.

1. **UI spike (throwaway):** a Svelte 5 prototype of just the editing core — nested bullets, Enter/Tab/Shift+Tab, arrow-key focus movement, edit-in-place using per-node plain-text contenteditable (key decision 9) — against in-memory data. No persistence, no server, no polish. Timebox: 2–3 days.
2. **Go/no-go on feel.** If the editing experience isn't great, fix or rethink before writing anything else.
3. Core model and validation
4. JSONL read/write (lenient parse, pre-order emit, mtime-checked atomic writes)
5. Tree building
6. CLI `init`
7. CLI `add`
8. CLI `list`
9. CLI `next`
10. CLI `done` / `reopen`
11. CLI `show`
12. CLI `update`
13. CLI `move`
14. CLI `delete`
15. CLI `search`
16. CLI `validate`
18. Local server (API + file watching + SSE)
19. Real Svelte UI, carrying over learnings from the spike
20. Inline token parsing in UI (`p1`–`p3`, `#tag`, `@human`/`@agent`)
21. Keyboard shortcuts, undo/redo
22. Polish

---

## Testing priorities

Add tests for:

* JSONL parsing (including lenient parsing of non-pre-order files)
* Invalid JSONL handling
* Duplicate IDs
* Missing parents
* Cycle detection
* Pre-order emission on write
* Task filtering
* Priority defaulting to 2
* Priority range validation
* `createdBy` resolution: `--by` beats env, env beats the TTY heuristic; web UI always writes human
* `createdBy` omitted for human authorship, never written as `"human"`
* `startedAt` set by `start`, cleared by `end`, preserved by `done`
* `start` refuses an already-started task without `--force`, succeeds with it
* `blockedBy` cleanup when a referenced node is deleted
* Blocker cycle detection (direct, and transitive through a chain)
* Blocker referencing a missing node fails validation
* `blockedBy` omitted rather than written as `[]` when the last blocker is removed
* `next` selection
* `doneAt` setting
* Moving nodes (subtree moves as a block)
* Preventing invalid moves
* Delete: leaf, refusal with children, `--recursive`
* mtime conflict detection and single retry
* Regex parsing of `p1`–`p3`
* Not parsing invalid priority strings
* Regex parsing of `#tag` and `@human`/`@agent` tokens
* Not parsing `#` or `@human`/`@agent` inside longer words
* Tag validation (lowercase, no whitespace, unique, no empty array)
* Deterministic tag colour assignment

Important `next` tests:

```text
p1 task beats p3 task
p1 task beats default (p2) task
two p1 tasks preserve outline order
done tasks are ignored
started tasks are ignored; ending returns them to the queue
human-assigned tasks are ignored; agent-assigned and unassigned are equal
agent-created tasks are eligible exactly like human-created ones
tasks under a done parent task are ignored
tasks under done bullet ancestors are NOT affected (bullets have no done state)
tasks with an open blocker are ignored
tasks whose blockers are all done are eligible
a blocker in an unrelated subtree still blocks
bullet nodes are ignored
no eligible task: non-zero exit, {"id": null} in JSON mode
```

---

## Tone of product

Kalamu should feel like:

```text
tiny
local
fast
plain text adjacent
git-native
agent-readable
keyboard-first
```

It should not feel like:

```text
project management software
enterprise SaaS
task bureaucracy
a database app
a second issue tracker
```

The best version of Kalamu is a small, sharp tool that developers leave in their repos because it is useful for both human thinking and agent execution.
