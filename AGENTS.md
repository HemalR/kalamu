# Kalamu

Repo-local, keyboard-first outliner for solo developers and coding agents. **SPEC.md is canonical** — read it before making design decisions; its "Key design decisions" section is settled and must not be relitigated.

## Dogfooding rule

This repo uses Kalamu itself — as a parking lot for deferred work, never as a log of the current conversation. Use the CLI: `node packages/cli/dist/index.js add --kind task --text "..."` (or the `kalamu` bin when linked); before the CLI builds, append a line to `.kalamu/outline.jsonl` by hand following SPEC.md's data model exactly.

- Agents add nodes in exactly three cases, always `--kind task`:
  1. Work discovered in this conversation but deliberately not done in it.
  2. Something the human must do that this conversation won't deliver (a decision for later, a credential, a manual step) — `--assign human`. Agents must never work on human-assigned tasks.
  3. The human explicitly asked for it to be tracked. (This covers human-invoked workflows whose spec writes to the outline — e.g. wayfinder charting, the one context where an agent may create `--kind discussion`, because the human invoked the skill that defines those tickets.)
- Nothing else becomes a node. Findings, summaries, live topics, and outcomes belong in chat — or in SPEC.md when it's a settled design decision. When unsure, don't record: say it in chat and let the human park it.
- Placement is part of the record. Before adding, find the branch the node belongs to (`kalamu list`, `kalamu search <term>`) and nest it there with `--parent <id>` — work discovered while doing a task usually belongs under that task or its umbrella; a human-assigned follow-up belongs under the work that raised it. Top level is for genuinely new areas only, never the path of least effort: a bolted-on orphan at the end of the outline disrupts the human's structure instead of extending it.
- Discussions are the human's tool. The human creates them to park topics for a later agent session; agents never create one on their own initiative. When the human brings one to a session (by id, or via the UI's Copy prompt), discuss only — no code changes — then record the outcome as child bullets and mark it done.
- Do NOT use TODO comments, a TODO.md, or other task systems for deferred work in this repo.

## Structure

pnpm monorepo:

- `packages/core` — data model, JSONL I/O, tree, validation, operations. No CLI/UI imports.
- `packages/cli` — `kalamu` binary (Commander) + local Hono server; bundles core via tsup; ships compiled web assets in `dist/web/`.
- `packages/web` — Svelte 5 (runes) + Vite UI. Plain Svelte SPA, NOT SvelteKit — never introduce SvelteKit idioms or dependencies.

## Commands

- `pnpm install` — install workspace deps
- `pnpm test` — Vitest across workspace
- `pnpm build` — builds web, copies assets into cli/dist/web, bundles cli
- `pnpm -F @kalamu/core test` — core tests only

## Conventions

- TypeScript strict everywhere; never `any` (prefer `unknown` + narrowing).
- Priority: p1 = high, p2 = medium, p3 = low; missing = p2. Never write `"priority": 2` or a null/empty `assignee` — omit defaults.
- Tags live inline in node text as `#tokens` (no `tags` field); the tag set is derived from text. Priority stays a field.
- `outline.jsonl` line order IS sibling order; writer emits pre-order traversal; all file writes are temp-file + atomic rename with mtime conflict check.
- Svelte work goes through the svelte-developer agent with the svelte-code-writer skill.

## Agent skills

### Issue tracker

Issues live in Kalamu (`.kalamu/outline.jsonl`). See `docs/agents/issue-tracker.md` — its "Wayfinding operations" section is what `/wayfinder` consults.
