# Kalamu Build Brief

## Product summary

Build **Kalamu**, a brutally simple, repo-local, keyboard-first outliner for solo developers and coding agents.

Kalamu is inspired by Workflowy-style infinite bullet nesting, but designed specifically for coding projects. It gives a developer a lightweight place to think, brainstorm, decompose ideas, and mark some items as executable tasks. Agents can then inspect the structured scratchpad, pick the next task deterministically, hand off tasks into fuller systems, and mark work complete.

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
2. A deterministic CLI contract for agents (stable IDs, `next`, `handoff`).

Everything else is in service of those two. If a feature strengthens neither, it does not belong.

---

## Key design decisions

These were deliberated and are settled. Do not relitigate them during implementation.

1. **Line position is canonical sibling order.** There is no `order` field. The writer always emits the file in pre-order traversal; the parser is lenient. See [Outline ordering](#outline-ordering).
2. **`p1` is urgent, `p5` is low.** Matches P0/P1-is-highest developer convention. Missing priority means `p3` (normal). `next` sorts priority ascending.
3. **`done` carries semantics on tasks only.** (Amended 2026-07-10: bullets CAN be marked done — strikethrough in the UI — and `clean` removes a done bullet once nothing beneath it survives. A bullet's `doneAt` never affects `next` eligibility or umbrella closing; bullets remain non-work-items.)
4. **A done or handed-off ancestor TASK closes its subtree.** Tasks under it are ineligible for `next`. Done bullets never close anything (see 3).
5. **Live reload is not optional.** The server watches the file and pushes changes to the UI; all writers use mtime-checked atomic writes. See [Concurrency](#concurrency).
6. **The UI ships with undo and delete.** A keyboard-first tool that moves subtrees without undo loses user data and trust.
7. **Tags live inline in the text.** A tag IS its `#token` in the node's text ("Build a new #feature to do xyz") — there is no `tags` field; tags are derived from the text. Chips are a rendering of the token in place: unfocused nodes show chips, the focused node shows raw text, so tags are edited and deleted like any other text. Colours are derived deterministically from the tag name (overridable in `meta.json`). No tag-management commands — a tag exists because text mentions it.
8. **Assignment: human or agent.** (Amended 2026-07-10: replaces the earlier `self: true` flag.) `assignee: "human"` marks a task the developer keeps for themselves — `next` never returns it. `assignee: "agent"` explicitly marks agent work; omitted means unassigned, which is agent-eligible exactly like `"agent"`. This is still audience, not people: the only two values are the developer at the keyboard and their agents — Kalamu has no concept of users. Legacy `"self": true` reads as `assignee: "human"` and is rewritten on the next write.
9. **Per-node plain-text contenteditable, no editor library.** Each node's text is its own `contenteditable="plaintext-only"` element using Svelte's native bindings (`bind:textContent`). Structural keys (Enter, Tab, Backspace-on-empty) are intercepted — guarded by `event.isComposing` for IME — and become outline operations; token parsing writes back only on commit (Enter/blur), never mid-keystroke, since external updates to bound content reset the caret. No TipTap/ProseMirror — those are document editors, and Kalamu's structure lives in the data model, not the editor. Fallback if the spike finds trouble: a roaming single editor where only the focused node is live. The UI spike exists to validate this.
10. **Collapse state is view state, never document content.** It lives in a gitignored `.kalamu/ui-state.json`, not in `outline.jsonl` — otherwise every fold click dirties the canonical file and pollutes Git history. Agents and the CLI always operate on the full tree regardless of what is collapsed.
11. **Images are files referenced by inline markdown tokens.** Pasting an image stores it in `.kalamu/assets/` (content-hashed filename, COMMITTED — assets are outline content and must survive a clone) and inserts `![](.kalamu/assets/img-<hash>.<ext>)` into the node text. Same rendering model as tags: unfocused nodes show a thumbnail in place, the focused node shows the raw token. No new node field; agents see an ordinary greppable path.

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

Kalamu is not Linear, Jira, GitHub Issues, Backlog.md, Dex, or Todoist.

Avoid:

* Multi-user assignments (the two-value `assignee` — human vs agent — is audience, not users)
* Due dates
* Comments
* Rich task workflows
* Complex status fields
* Kanban boards
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
{"collapsed": ["n_002", "n_014"]}
```

`ui-state.json` is written by the server (debounced, atomic) and is never canonical: missing or corrupt means every node renders expanded. `kalamu validate` ignores it. IDs of since-deleted nodes are harmless and may be pruned opportunistically.

Optional runtime cache, if needed later:

```text
.kalamu/cache.sqlite
```

But `cache.sqlite` is never canonical and is gitignored.

Recommended `.gitignore` entries:

```gitignore
.kalamu/cache.sqlite
.kalamu/ui-state.json
.kalamu/*.lock
```

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
type NodeKind = "bullet" | "task";

type Handoff = {
  at: string;
  target: string;
  ref: string;
};

type KalamuNode = {
  id: string;
  parentId: string | null;
  kind: NodeKind;
  text: string;
  createdAt: string;
  doneAt: string | null;
  handoff: Handoff | null;
  priority?: 1 | 2 | 3 | 4 | 5;
  assignee?: "human" | "agent";
};
```

There is deliberately no `order` field — sibling order is the relative order of lines in the file. See [Outline ordering](#outline-ordering).

There is also deliberately no `collapsed` field — collapse state is view state and lives in the gitignored `.kalamu/ui-state.json` (key decision 10), never in the outline.

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
"bullet" | "task"
```

* `bullet` means thought/text/heading
* `task` means agent-executable work item

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

#### `handoff`

Nullable object.

Used when a Kalamu task has been promoted into another system.

Examples:

```json
{
  "at": "2026-07-09T07:00:00.000Z",
  "target": "backlog",
  "ref": "backlog/tasks/add-org-sso.md"
}
```

```json
{
  "at": "2026-07-09T07:00:00.000Z",
  "target": "github",
  "ref": "https://github.com/acme/app/issues/42"
}
```

Do not use `handoffAt` alone because the system needs to know where the task went.

#### `priority`

Optional.

Only meaningful for `kind: "task"`.

Allowed values:

```ts
1 | 2 | 3 | 4 | 5
```

Default priority is `3`.

Do not write `"priority": 3` unless there is a strong reason. Missing priority means default priority.

Semantics — **lower number is more urgent**, matching P0/P1 developer convention:

```text
p1 = urgent / pick first
p2 = high
p3 = normal/default
p4 = below normal
p5 = low
```

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

This is audience, not users. Kalamu has no user accounts; the only two parties are the developer at the keyboard and their agents.

Legacy note: files written before this decision may carry `"self": true`; readers treat it as `assignee: "human"` and drop the field on the next write.

---

## Example JSONL

```jsonl
{"id":"n_001","parentId":null,"kind":"bullet","text":"Auth improvements","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null,"handoff":null}
{"id":"n_002","parentId":"n_001","kind":"bullet","text":"SSO","createdAt":"2026-07-09T07:01:00.000Z","doneAt":null,"handoff":null}
{"id":"n_003","parentId":"n_002","kind":"task","text":"Investigate WorkOS org mapping #research","createdAt":"2026-07-09T07:02:00.000Z","doneAt":null,"handoff":null,"priority":2}
{"id":"n_004","parentId":"n_002","kind":"task","text":"Add SAML config screen","createdAt":"2026-07-09T07:03:00.000Z","doneAt":null,"handoff":null}
{"id":"n_005","parentId":"n_001","kind":"bullet","text":"Login UX","createdAt":"2026-07-09T07:04:00.000Z","doneAt":null,"handoff":null}
{"id":"n_006","parentId":"n_005","kind":"task","text":"Fix password reset redirect","createdAt":"2026-07-09T07:05:00.000Z","doneAt":null,"handoff":null,"priority":1}
{"id":"n_007","parentId":null,"kind":"task","text":"Write launch blog post #publishing","createdAt":"2026-07-09T07:06:00.000Z","doneAt":null,"handoff":null,"assignee":"human"}
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
node.handoff === null
node.assignee !== "human"
// AND no ancestor task of the node is done or handed off
```

Blank tasks (whitespace-only text, typically stray empty nodes from the web
UI) are never returned — an agent cannot act on a task with no text.
`kalamu clean` removes them.

The ancestor rule: marking a parent task done (or handing it off) closes the whole umbrella. Agents should never pick up work under a closed parent. Bullet ancestors never affect eligibility.

Human-assigned tasks (`assignee: "human"`) are never returned — they belong to the developer, not the agent queue. Unassigned and `"agent"` tasks are equally eligible.

Sorting:

1. Priority **ascending** (p1 first), where missing priority means `3`
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

There is no `--explain` flag — the default text output already includes the reason line.

Later (not MVP):

```bash
kalamu next --include-handed-off
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
kalamu handoff <id>
kalamu unhandoff <id>
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

Interactively (TTY, not JSON mode), a fresh `init` ASKS "Seed a two-minute tour
outline to learn the UI? [Y/n]" instead of requiring the flag; `--tour` forces,
`--no-tour` suppresses the question. Non-TTY runs (agents, scripts) are never
prompted and never seeded — a fresh non-interactive init just prints a one-line
hint that `init --tour` exists.

When run interactively (TTY), `init` then offers to install the **Kalamu agent
skill** by delegating to `npx skills add <owner/repo>` — the skills.sh CLI asks
which agents to install for and owns every agent's skills directory. `--skill`
forces the install, `--no-skill` suppresses the offer, and a non-TTY run (an
agent or script) never prompts.

The skill itself lives at `skills/kalamu/SKILL.md`, follows the agent-agnostic
Agent Skills spec (agentskills.io: frontmatter `name` matching the directory +
keyword-rich `description`; body < 500 lines), and is published simply by this
repo being public on GitHub — skills.sh indexes discoverable `skills/<name>/`
layouts automatically; there is no separate publish step. The skill teaches any
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
2. Ensure `.kalamu/outline.jsonl` exists.
3. Start local HTTP server on `127.0.0.1`.
4. Serve prebuilt web app assets.
5. Expose API endpoints for reading/writing nodes.
6. Watch the JSONL file and push changes to the UI (see [Concurrency](#concurrency)).
7. Open browser unless `--no-browser` is passed.

The browser never reads/writes files directly. The local server owns file access.

---

### `kalamu list`

Lists outline nodes.

Default output should be human-readable.

Useful options:

```bash
kalamu list --tasks
kalamu list --open
kalamu list --done
kalamu list --handoff
kalamu list --tag <tag>
kalamu list --assignee <human|agent>
kalamu list --depth 2
kalamu list --format json
```

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
--kind bullet|task
--text <text>
--p <1-5>
--tag <tag>
--assign <human|agent>
--after <id>
--before <id>
--format json
```

`--tag` is repeatable and appends the `#tag` token to the text (tags live inline in text). `--assign human` marks a task as the developer's own (excluded from `kalamu next`); `--assign agent` explicitly claims it for agents.

If `--parent` is omitted, add as top-level.

If `--kind` is omitted, default to `bullet`.

If neither `--after` nor `--before` is given, append as last sibling.

If priority is omitted for a task, do not write priority; treat it as default `3`.

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
--kind bullet|task
--p <1-5|default>
--add-tag <tag>
--remove-tag <tag>
--assign <human|agent|none>
```

`--p default` removes the stored priority (reverting to implicit `p3`).

`--add-tag` and `--remove-tag` are repeatable text surgery: add appends the `#tag` token, remove strips the token(s) from the text. `--assign` sets the assignee; `--assign none` clears it back to unassigned.

Converting a `task` back to `bullet` preserves `doneAt`, `handoff`, and `priority`. They are inert on bullets and are restored if the node is converted back to a task.

Validation:

* Do not allow priority outside 1–5.
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

Valid for both kinds, with different meanings. On a **task** it is a state
change with full semantics (excluded from `next`, closes its umbrella, removed
by `clean`). On a **bullet** it is strikethrough styling plus cleanup: a done
bullet never gates its descendants' eligibility for `next`, but `clean`
removes it once nothing beneath it survives. Bullets stay non-work-items
regardless of `doneAt`.

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

### `kalamu handoff <id>`

Records that a Kalamu task has been promoted elsewhere.

Examples:

```bash
kalamu handoff n_003 --target backlog --ref backlog/tasks/explore-sso.md
kalamu handoff n_003 --target github --ref https://github.com/acme/app/issues/42
kalamu handoff n_003 --target linear --ref ENG-123
kalamu handoff n_003 --target file --ref plans/auth-sso.md
```

Stores:

```json
"handoff": {
  "at": "2026-07-09T07:00:00.000Z",
  "target": "backlog",
  "ref": "backlog/tasks/explore-sso.md"
}
```

---

### `kalamu unhandoff <id>`

Clears a task's handoff record (sets `handoff: null`), making it eligible for
`kalamu next` again — e.g. when the external system fell through and the work
comes back home. Errors on bullets and on tasks with no handoff to clear.

```bash
kalamu unhandoff n_003
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
  ancestors(n).some(a =>
    a.kind === "task" && (a.doneAt !== null || a.handoff !== null)
  );

const eligible = nodes.filter(n =>
  n.kind === "task" &&
  n.text.trim() !== "" &&
  n.doneAt === null &&
  n.handoff === null &&
  n.assignee !== "human" &&
  !closedAncestor(n)
);

sort by:
  priority ascending, default 3 (p1 first)
  outline order ascending
```

Flags:

```bash
kalamu next --under <id>           # only consider tasks inside this node's subtree
kalamu next --include-handed-off   # readmit handed-off tasks/umbrellas (done exclusions still apply)
kalamu next --limit <n> | --all    # batch mode: the queue in next-order
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

* Removes every task with `doneAt !== null`, together with its entire subtree — consistent with key decision 4: a done parent task closes its umbrella, so anything beneath it is moot.
* Removes done bullets and blank nodes (whitespace-only text, either kind) — but only when they have no surviving children. A done bullet does not close its umbrella and a blank node is structural, so either stays while real content beneath it survives. Chains of removable nodes collapse in one pass (children are decided before parents).
* Handed-off tasks that are not done are NOT removed (handed off is not completed).
* `--dry-run` lists what would be deleted without writing.

Example output:

```text
Deleted 6 node(s) (3 done task(s), 1 done bullet(s), 1 blank node(s))
```

JSON:

```json
{"deleted": 6, "doneTasks": 3, "doneBullets": 1, "blankNodes": 1, "ids": ["n_007", "n_008", "n_009", "n_010", "n_011", "n_012"]}
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
* `kind` is either `bullet` or `task`.
* `doneAt` is either `null` or a valid ISO timestamp.
* `handoff` is either `null` or has `at`, `target`, and `ref`.
* `priority`, if present, is an integer 1–5.
* `assignee`, if present, is `"human"` or `"agent"` and the node is a task.

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
* Assigned tasks visibly distinct: a small user icon marks human-assigned tasks, a robot icon marks agent-assigned ones; unassigned tasks show neither
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

Default priority `p3` should generally be hidden.

Handed-off task:

```text
☐ Add audit logs → backlog
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
Enter                    create new sibling; on an EMPTY node it toggles bullet/task
                         instead (never creates below an empty one; outdenting an
                         empty node is Shift+Tab's job)
Tab                      indent
Shift+Tab                outdent
ArrowUp/ArrowDown        move focus (goal column preserved: the caret keeps aiming
                         for its remembered column across consecutive vertical moves,
                         clamped to line length; any other key resets it)
Cmd/Ctrl+ArrowUp         move node up
Cmd/Ctrl+ArrowDown       move node down
Cmd/Ctrl+Enter           toggle bullet/task
Cmd/Ctrl+Shift+Enter     mark item done/reopen — visual-only strikethrough on
                         bullets (not Cmd+D — it works while editing
                         but falls through to the browser's bookmark dialog when
                         no node is focused)
Cmd/Ctrl+K               open the command palette (priority, labels, assign)
Cmd/Ctrl+.               toggle collapse/expand
Backspace (empty node)   delete node
Backspace (caret at 0)   clear the node's priority (tags are plain text — backspace them directly)
Cmd/Ctrl+Shift+Backspace delete node with subtree (undoable)
Cmd/Ctrl+Shift+C         copy the focused node's id (as the CLI knows it) to the clipboard
Cmd/Ctrl+/               open keyboard cheat sheet ("?" also opens it when not editing)
Cmd/Ctrl+Z               undo
Cmd/Ctrl+Shift+Z         redo
```

Modifier choice is deliberate: no Alt/Option combos (macOS Option-key character
substitution, and tiling window managers like Aerospace bind them globally), no
Cmd+M / Cmd+1..9 / Cmd+Shift+3-5 (OS- or browser-reserved). Node metadata that
previously had Alt shortcuts (priority, assignee) lives in the command palette.

Need not implement all shortcuts in first pass, but structure the code so they can be added cleanly.

---

## Command palette

Cmd/Ctrl+K opens a command palette — including while a node is being edited. It
acts on the last-focused node and offers, at the top level:

```text
1  Priority  ->  submenu: 1-5 set the priority (3 = back to default), current level marked
2  Labels    ->  submenu: every #tag in the outline, checkmark if the node has it;
                 selecting toggles the #token in the node's text (tags stay inline —
                 key decision 7); stays open for multi-toggle
3  Assign    ->  submenu: Human / Agent / Unassigned, current value marked;
                 selecting sets the task's assignee (Unassigned clears it), closes
4  Toggle done   direct action: marks the task done / reopens it, closes
5  Copy CLI command -> submenu: ready-to-run CLI commands for this node with its
                 real (server) id filled in — show --children always; done or
                 reopen (by state) and a handoff template on tasks; add-child-task;
                 delete (--recursive when the node has children). Picking one
                 copies it to the clipboard, shows a toast, closes with focus
                 restore.
6  Activate dark mode       direct action: switches the theme, closes; the label
                 reads "Activate light mode" when the current mode is dark
7  Clean up                 direct action: deletes every done task with its
                 subtree, plus done bullets and blank nodes (same as
                 `kalamu clean`), applied through the UI's undo stack so it
                 is undoable in-session; toasts the result ("Deleted 4 nodes
                 (3 done tasks)" / "Nothing to clean."), closes
8  View keyboard shortcuts   opens the keyboard cheat sheet
9  View CLI commands         opens the CLI commands sheet
```

The list is fixed: all nine items always render, in this order, with stable
numbers — the two view sheets are always the last items. Items that don't apply
are greyed out and disabled rather than hidden — with no node focused, 1–5 are
disabled (the theme, clean and view items need no target and are always
enabled — Clean up with nothing to clean just toasts "Nothing to clean."); on a
bullet, only Priority and Assign are disabled — Toggle done
works on bullets as a visual-only strikethrough (Copy CLI command stays
enabled, with task-only commands omitted from its submenu; done/reopen appear
for bullets too). Disabled items don't respond to digits, Enter, or clicks, and
arrow navigation skips them. The CLI commands sheet mirrors `kalamu --help` —
command names with one-line descriptions — as a reference for the developer;
agents use `--help` itself.

Key rules:

* Items are numbered; a digit activates that item **only while the query is
  empty** — so `Cmd+K 1 2` sets p2, yet typing `v2` still filters to the `#v2` tag.
* Any other typing filters the current level's items; ArrowUp/Down + Enter select.
* Esc steps back up a level and closes at the top; Backspace on an empty query
  does the same. Closing returns focus to the node the palette was acting on.
* When focus falls to the body while the window stays focused (Tab out, or an
  extension that blurs inputs on Esc — e.g. Vimium — eating the keypress before
  the page sees it), the palette treats the blur as Esc: step back and refocus
  at a sublevel, close at the root. Esc therefore behaves identically with or
  without such an extension. Focus moving to a real element outside the palette
  closes it without refocusing; switching apps does not close it.
* Priority and assign actions close the palette; label toggles keep it open.

---

## Priority parsing in UI

The UI should cleverly parse priority from text.

If user types:

```text
Fix broken upload p1
```

and the node is a task, store:

```json
"text": "Fix broken upload",
"priority": 1
```

Do not store `p1` in text.

Regex should be conservative:

```regex
/(?:^|\s)p([1-5])(?:\s|$)/i
```

Rules:

* `p1` to `p5` are valid.
* `p3` means default; omit priority from stored JSON unless explicitly choosing to store it.
* Do not parse `p10`, `p99`, `P256`, etc.
* Do not parse inside longer words.
* A priority token always OVERRIDES an existing stored priority (typing `p2` on a `p4` task makes it `p2`).
* Parse timing: when the user types a space, parse ONLY the just-completed token immediately before the caret (instant badge feedback, no whole-text rescans per keystroke). Commit-time parsing (Enter/blur) remains as the backstop for pasted or mid-line-edited text. This applies to `pN` and `@human`/`@agent` tokens; `#tags` stay in the text by design.

Unlike tags, priority is NOT stored in text — `p2` is metadata, not prose, and it drives the agent-facing `next` sort, so it stays a first-class field. Rendering gives it text-like ergonomics:

* The priority badge renders at the START of the row (after the checkbox, before the text) so priorities line up in a scannable column regardless of text length.
* Backspace with the caret at position 0 of the node text clears the priority (reverts to default).
* Clicking the badge opens a dropdown (p1–p5 + clear-to-default); tasks at default priority show a subtle ghost badge on row hover/focus that opens the same dropdown.

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

* Clicking a chip (in an unfocused node) opens a small popover showing the ~12 palette swatches plus a "default" option. Picking a swatch writes the override to `meta.json` via the server; "default" clears it, reverting to the hash-derived colour. Clicking non-chip text focuses the node with the caret mapped to the equivalent source position.
* The popover also offers **Filter by #tag**: the outline shows only matching nodes, their ancestors (structure), and their descendants (a tagged umbrella includes its contents). A dismissible pill above the outline shows the active filter; clicking it (or Esc outside editing) clears it. One tag at a time; session-only — never persisted to `ui-state.json`.

### Assignment in the UI

* Assigned tasks show a subtle icon after the text — a user icon for `"human"`, a robot icon for `"agent"` — so they scan differently from unassigned tasks. The icons match the @ dropdown's.
* Assignment is set from the @ dropdown, `@human`/`@agent` tokens, or the palette's Assign submenu (no dedicated shortcut — Cmd+M is OS-reserved).

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
          handoff.ts
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
POST   /api/nodes/:id/handoff
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
* `kalamu next` returns the lowest-priority-number (most urgent) open, unhanded-off task with no closed ancestor task.
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
kalamu handoff <id> --target file --ref plans/some-task.md
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
15. CLI `handoff`
16. CLI `search`
17. CLI `validate`
18. Local server (API + file watching + SSE)
19. Real Svelte UI, carrying over learnings from the spike
20. Inline token parsing in UI (`p1`–`p5`, `#tag`, `@human`/`@agent`)
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
* Priority defaulting to 3
* Priority range validation
* `next` selection
* `doneAt` setting
* `handoff` setting
* Moving nodes (subtree moves as a block)
* Preventing invalid moves
* Delete: leaf, refusal with children, `--recursive`
* mtime conflict detection and single retry
* Regex parsing of `p1`–`p5`
* Not parsing invalid priority strings
* Regex parsing of `#tag` and `@human`/`@agent` tokens
* Not parsing `#` or `@human`/`@agent` inside longer words
* Tag validation (lowercase, no whitespace, unique, no empty array)
* Deterministic tag colour assignment

Important `next` tests:

```text
p1 task beats p2 task
p2 task beats default (p3) task
two p1 tasks preserve outline order
done tasks are ignored
handed-off tasks are ignored
human-assigned tasks are ignored; agent-assigned and unassigned are equal
tasks under a done parent task are ignored
tasks under a handed-off parent task are ignored
tasks under done/handed-off bullet ancestors are NOT affected (bullets have no done state)
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
