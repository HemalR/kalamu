# Kalamu

Repo-local, keyboard-first outliner for solo developers and coding agents. **SPEC.md is canonical** — read it before making design decisions; its "Key design decisions" section is settled and must not be relitigated.

## Dogfooding rule

This repo uses Kalamu itself. Any deferred todo — including todos for the human — goes into `.kalamu/outline.jsonl`:

- Once the CLI builds, use it: `node packages/cli/dist/index.js add --kind task --text "..."` (or the `kalamu` bin when linked).
- Before the CLI exists/builds, append a line to `.kalamu/outline.jsonl` by hand following SPEC.md's data model exactly.
- Tasks for the human (not for agents) get `--assign human` (`"assignee": "human"`). Agents must never work on human-assigned tasks.
- Topics to talk through with the human get `--kind discussion`. Discussions are never coding work: when the human raises one, discuss only — no code changes — then record the outcome as child bullets and mark it done.
- When your work needs the human to do something (a decision, a credential, a manual step), don't just say so in chat — also record it as a human-assigned task so it survives the conversation.
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
