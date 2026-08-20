# Issue tracker: Kalamu

Issues for this repo live in `.kalamu/outline.jsonl`, managed by the Kalamu CLI. Run it as `node packages/cli/dist/index.js` (or `kalamu` when the bin is linked). The dogfooding rules in `CLAUDE.md` still apply on top of everything here — agents never work human-assigned tasks, and discussions are never coding work.

## Conventions

- **Create an issue**: `kalamu add --kind task --text "..."` (`--parent <id>` to nest, `--p 1|2|3` for priority, `--assign human` for the developer's own work).
- **Read an issue**: `kalamu show <id> --children` (`--format json|markdown` as needed).
- **List issues**: `kalamu list --open`, with `--tag <tag>`, `--discussions`, `--blocked`, `--format json` filters.
- **Comment on an issue**: add a child bullet — `kalamu add --parent <id> --text "..."`.
- **Apply / remove labels**: labels are inline `#tags` in node text — `kalamu update <id> --add-tag <tag>` / `--remove-tag <tag>`.
- **Close**: `kalamu done <id>`. Reopen with `kalamu reopen <id>`.
- **Search**: `kalamu search <query>`.
- **Place a node**: `kalamu ls` then `kalamu ls <id>` to walk to the parent without reading the whole outline; then `kalamu add --parent <id>`.
- **Reference a spec doc**: write the repo-relative `.md` path in the node text (`Spec: plans/foo.md Phase 2`); the UI renders it as a chip that opens the file (SPEC key decision 19). Prose stays in the doc, state stays in the node — never duplicate one into the other.
- **Reference any other repo file**: write it with an `@` — `@packages/web/src/lib/caret.ts`. Bare `.md` paths chip on their own; every other file needs the `@` marker.

## When a skill says "publish to the issue tracker"

Create a node with `kalamu add`.

## When a skill says "fetch the relevant ticket"

Run `kalamu show <id> --children`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a node whose **children** are the tickets — Kalamu's tree gives parent/child linking natively. Ticket creation here is human-directed (the human invoked the skill that defines these tickets), so creating discussion-kind tickets during charting is the sanctioned exception to the standing rule that agents never create `--kind discussion` nodes.

- **Map**: a top-level `bullet` node tagged `#wf-map`; its text is the effort name plus a one-line destination gist. Its first five children are section bullets, in order: `Destination`, `Notes`, `Decisions so far`, `Not yet specified`, `Out of scope` — each section's content lives as child bullets beneath it. Find any map with `kalamu list --tag wf-map`.
- **Child ticket**: a child node of the map (a sibling of the section bullets, added after them). The node text is the ticket's question; extended context goes in child bullets. Kind and tag by wayfinder type:
  - research → `--kind task --tag wf-research` (AFK, enters the task queue)
  - task → `--kind task --tag wf-task`; the HITL variant (a checklist for the human) adds `--assign human` so `next` skips it
  - grilling → `--kind discussion --tag wf-grilling` (HITL)
  - prototype → `--kind discussion --tag wf-prototype` (HITL)
- **Blocking**: native — `kalamu block <id> --by <blocker-id>` works on tasks **and** discussions; `kalamu unblock <id> [--by <blocker-id>]` removes edges. A blocker stops blocking once done; blocker cycles are validation errors. Blocked nodes render with a Blocked badge in the UI.
- **Frontier query**: `kalamu next --all --under <map-id>` lists the AFK frontier (open, unblocked, unclaimed, not human-assigned, queue order); `kalamu next --discussion --all --under <map-id>` lists the HITL frontier. First in queue order wins (priority, then outline order).
- **Claim**: `kalamu start <id>` — the session's first write, before any work. Tasks only: discussions cannot be claimed; they are HITL, so the human driving the session is the claim. `kalamu start <id> --force` re-claims a ticket whose session died; `kalamu end <id>` releases a claim without resolving.
- **Resolve**: record the answer as child bullets of the ticket (one bullet per point — the same outcome-bullets pattern used everywhere in this repo), then `kalamu done <id>`, then append a context pointer under the map's `Decisions so far` section bullet: `kalamu add --parent <decisions-section-id> --text "<ticket name> — <one-line answer gist> (<ticket-id>)"`.
- **Refer by name**: a ticket's name is the first line of its text; never give the human a bare node id. Use `kalamu link <id>` for a named, copy-ready hub deep link.
