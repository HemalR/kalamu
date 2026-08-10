# Kalamu as a wayfinder backend

[Wayfinder](https://github.com/mattpocock/skills/blob/main/skills/engineering/wayfinder/SKILL.md) plans a large effort as a shared map of decision tickets on your repo's issue tracker. The skill is tracker-agnostic: it reads the repo's tracker doc (`docs/agents/issue-tracker.md`) and follows its "Wayfinding operations" section. This example provides that doc for Kalamu, so the map and its tickets live in `.kalamu/outline.jsonl` instead of GitHub Issues.

The fit is close to 1:1: Kalamu's tree is the map/ticket hierarchy, `startedAt` is the claim, `blockedBy` is native dependency blocking (tasks and discussions), and `kalamu next --under <map-id>` computes the frontier — open, unblocked, unclaimed tickets in queue order — in one command.

## Setup in your repo

One command, run at the repo root:

```bash
npx kalamu init --wayfinder
```

That initialises `.kalamu/` if needed, writes this template to `docs/agents/issue-tracker.md`, and plants a marker-fenced pointer block in the repo's `CLAUDE.md`/`AGENTS.md` (creating `AGENTS.md` when neither exists). It is safe to re-run: after a Kalamu update it refreshes both files in place, and your text outside the markers is never touched. To customise the tracker doc, delete the generated line at its top — init then treats the file as yours and stops refreshing it.

Then, once per machine, install the wayfinder skill and its companions (`grilling`, `research`, `prototype`) from [mattpocock/skills](https://github.com/mattpocock/skills): `npx skills add mattpocock/skills`.

That's the whole integration — the wayfinder skill itself needs no modification. Manual alternative: copy [`issue-tracker.md`](./issue-tracker.md) to `docs/agents/issue-tracker.md` yourself and add a pointer to it under an `## Agent skills` heading in `CLAUDE.md`/`AGENTS.md` (or run `/setup-matt-pocock-skills`, choose "Other", and point it at the doc).

## Notes

- Discussions (grilling/prototype tickets) can be blocked but not claimed — they're human-in-the-loop, so the human driving the session is the claim. Concurrent AFK sessions coordinate through `kalamu start` on task-kind tickets.
- Blockable discussions need a Kalamu release newer than v0.10.0 (SPEC key decision 16, amended 2026-08-10).
- Tag names allow only `[a-z0-9-]`, so wayfinder's `wayfinder:<type>` labels become `#wf-map`, `#wf-research`, `#wf-prototype`, `#wf-grilling`, `#wf-task`.
