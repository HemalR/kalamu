/**
 * All CLI commands as pure-ish testable functions: (cwd, options) -> CommandResult.
 * The commander wiring in index.ts only parses argv and prints.
 */
import {
  addBlocker,
  addNode,
  ancestors,
  buildTree,
  cleanDone,
  deleteNode,
  depthOf,
  deriveTags,
  endTask,
  effectivePriority,
  eligibleTasks,
  markDone,
  moveNode,
  nextTask,
  pathOf,
  preorder,
  removeBlocker,
  reopen as reopenOp,
  searchNodes,
  serializeMarkdown,
  startTask,
  subtreeIds,
  updateNode,
  validateOutline,
  type Assignee,
  type KalamuNode,
  type NextOptions,
  type NodeKind,
  type Tree,
} from "@kalamu/core";
import {
  initKalamu,
  KALAMU_DIR,
  migrateStore,
  OUTLINE_FILE,
  PROJECT_FILE,
  readOutline,
  withOutline,
  type StoreKind,
} from "@kalamu/core/store";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseActor, resolveActor } from "./actor.js";
import { ensureAgentDocs } from "./agent-docs.js";
import { hubBaseUrl } from "./config.js";
import { CliError, findDoc, looksLikeRepo, resolvePaths, type CommandResult } from "./context.js";
import { ensureGitignore, IGNORE_ENTRIES } from "./gitignore.js";
import { createNodeLink } from "./link.js";
import { registerProject, slugFor } from "./registry.js";
import { glyphFor, prefixFor, renderOutline, suffixFor } from "./render.js";
import { seedTour } from "./tour.js";
import { ensureWayfinderDocs } from "./wayfinder-docs.js";

export type Priority = 1 | 2 | 3;

/** `--p`: 1-3, plus "default" where clearing is allowed (`update`). */
export function parsePriority(value: string, allowDefault: true): Priority | "default";
export function parsePriority(value: string, allowDefault: false): Priority;
export function parsePriority(value: string, allowDefault: boolean): Priority | "default" {
  if (allowDefault && value === "default") return "default";
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  throw new CliError(`invalid priority "${value}" — use 1 (high), 2 (medium) or 3 (low)${allowDefault ? ' or "default"' : ""}`);
}

export function parseKind(value: string): NodeKind {
  if (value !== "bullet" && value !== "task" && value !== "discussion") {
    throw new CliError(`invalid kind "${value}" — use bullet, task or discussion`);
  }
  return value;
}

/** `--assign`/`--assignee`: human or agent, plus "none" (null) where clearing is allowed (`update`). */
export function parseAssignee(value: string, allowNone: true): Assignee | null;
export function parseAssignee(value: string, allowNone: false): Assignee;
export function parseAssignee(value: string, allowNone: boolean): Assignee | null {
  if (allowNone && value === "none") return null;
  if (value !== "human" && value !== "agent") {
    throw new CliError(`invalid assignee "${value}" — use human or agent${allowNone ? " (or none to clear)" : ""}`);
  }
  return value;
}

export function parseStore(value: string): StoreKind {
  if (value !== "repo" && value !== "local") {
    throw new CliError(
      `invalid store "${value}" — use local (outside the repo, shared by every branch and worktree) or repo (committed in .kalamu/)`,
    );
  }
  return value;
}

function ignoreEntriesLine(added: string[]): string[] {
  return added.length ? [`Added ${added.length} .kalamu ignore entr${added.length === 1 ? "y" : "ies"} to .gitignore.`] : [];
}

/** `kalamu init`. The result type is inferred so the CLI wiring reads `json.created` without a cast. */
export function init(
  cwd: string,
  options: { agentDocs?: boolean; gitignore?: boolean; wayfinder?: boolean; store?: string } = {},
) {
  const store = options.store === undefined ? undefined : parseStore(options.store);
  const { created, paths } = initKalamu(cwd, { store });
  registerProject(paths.root);
  const docs = options.agentDocs === false ? [] : ensureAgentDocs(cwd);
  // .gitignore entries only matter while the data sits in the repo, and are
  // only written where a repo marker exists — elsewhere init just prints them
  // as a suggestion (SPEC ".gitignore entries").
  const inRepo = looksLikeRepo(cwd);
  const wantIgnores = paths.store === "repo" && options.gitignore !== false;
  const ignores = wantIgnores && inRepo ? ensureGitignore(cwd) : [];
  const wayfinder = options.wayfinder ? ensureWayfinderDocs(cwd) : { tracker: null, pointers: [] };
  const lines = [
    ...(docs.length ? [`Added the agent standing instruction to ${docs.join(" and ")}.`] : []),
    ...ignoreEntriesLine(ignores),
    ...(wayfinder.tracker ? [`Wrote ${wayfinder.tracker} (wayfinder issue-tracker doc).`] : []),
    ...(wayfinder.pointers.length ? [`Added the issue-tracker pointer to ${wayfinder.pointers.join(" and ")}.`] : []),
  ];
  const json = { created, store: paths.store, dir: paths.dir, agentDocs: docs, gitignore: ignores, wayfinder };
  if (!created) {
    return { text: [`Already initialised (${paths.dir})`, ...lines].join("\n"), json };
  }
  const suggestion =
    wantIgnores && !inRepo ? ["", "Suggested .gitignore entries:", ...IGNORE_ENTRIES.map((entry) => `  ${entry}`)] : [];
  const where =
    paths.store === "local"
      ? [
          `Initialised Kalamu — outline at ${paths.dir}`,
          `  marker: ${join(paths.root, KALAMU_DIR, PROJECT_FILE)} (commit it; every branch, worktree and clone shares this outline)`,
        ]
      : [`Initialised Kalamu in ${paths.dir}`];
  return { text: [...where, ...lines, ...suggestion].join("\n"), json };
}

/**
 * `kalamu migrate <store>` — move this project's data between the repo and
 * the local store (SPEC key decision 21). Everything the outline owns comes
 * along; the node count in the output is the human's check that nothing was
 * lost. Moving into the repo restores the .gitignore entries repo mode needs.
 */
export function migrate(cwd: string, to: string): CommandResult {
  const store = parseStore(to);
  const before = resolvePaths(cwd);
  const result = migrateStore(before.root, store);
  const ignores = store === "repo" && looksLikeRepo(before.root) ? ensureGitignore(before.root) : [];
  const extras = result.moved.filter((entry) => entry !== OUTLINE_FILE);
  const what = `${result.nodes} node${result.nodes === 1 ? "" : "s"}${extras.length ? ` + ${extras.join(", ")}` : ""}`;
  const lines =
    store === "local"
      ? [
          `Moved the outline out of the repo (${what}).`,
          `  data:   ${result.paths.dir}`,
          `  marker: ${join(before.root, KALAMU_DIR, PROJECT_FILE)}`,
          "Commit .kalamu/ — the marker replaces the old files, and every branch, worktree and clone now shares this outline.",
        ]
      : [
          `Moved the outline back into the repo (${what}).`,
          `  data: ${result.paths.dir}`,
          ...ignoreEntriesLine(ignores),
          "Commit .kalamu/ with your code.",
        ];
  return {
    text: lines.join("\n"),
    json: { from: result.from, to: result.to, dir: result.paths.dir, nodes: result.nodes, moved: result.moved, gitignore: ignores },
  };
}

export function tour(cwd: string): CommandResult {
  const paths = resolvePaths(cwd);
  withOutline(paths.outline, (nodes) => {
    // Never mix demo content into a real outline.
    if (nodes.length > 0) throw new CliError("--tour only seeds a fresh, empty outline");
    return { nodes: seedTour(nodes) };
  });
  return {
    text: "Seeded the onboarding tour — run `kalamu open` to take it.",
    json: { tour: true },
  };
}

/**
 * Best-effort markdown links for the `Link:` line and `link` field that
 * add/done/start/next carry, so the copy-ready reference is already in the
 * tool result an agent is reading. Unlike `kalamu link` — which fails loudly
 * rather than invent a broken URL — an unresolvable slug yields undefined:
 * registry failures never break the command that triggered them (SPEC "Hub").
 * The slug resolves once, so a batch links every entry cheaply.
 */
function nodeLinker(root: string): (node: Pick<KalamuNode, "id" | "text">) => string | undefined {
  const slug = slugFor(root);
  const base = hubBaseUrl();
  return (node) => (slug !== undefined ? createNodeLink(node, slug, base).markdown : undefined);
}

/** A node command's result with the node's best-effort `Link:` line and `link` field appended. */
function withLink(
  root: string,
  node: Pick<KalamuNode, "id" | "text">,
  text: string,
  json: Record<string, unknown>,
): CommandResult<Record<string, unknown>> {
  const link = nodeLinker(root)(node);
  return link === undefined ? { text, json } : { text: `${text}\nLink: ${link}`, json: { ...json, link } };
}

export interface AddOptions {
  parent?: string;
  kind?: string;
  text: string;
  p?: string;
  tag?: string[];
  assign?: string;
  by?: string;
  blockedBy?: string[];
  after?: string;
  before?: string;
}

export function add(cwd: string, options: AddOptions): CommandResult {
  const paths = resolvePaths(cwd);
  const { node, nodes } = withOutline(paths.outline, (nodes) => {
    const result = addNode(nodes, {
      parentId: options.parent,
      kind: options.kind !== undefined ? parseKind(options.kind) : undefined,
      text: options.text,
      priority: options.p !== undefined ? parsePriority(options.p, false) : undefined,
      tags: options.tag,
      assignee: options.assign !== undefined ? parseAssignee(options.assign, false) : undefined,
      createdBy: resolveActor(options.by),
      afterId: options.after,
      beforeId: options.before,
    });
    return applyBlockers(result.nodes, result.node, options.blockedBy ?? []);
  });
  const path = pathOf(buildTree(nodes), node);
  const location = path.length ? ` under ${path.join(" > ")}` : " (top-level)";
  // Agents (and non-TTY scripts) get a nudge when they omit --parent: that is
  // the failure mode the placement rule exists to stop. Humans adding a new
  // top-level area are doing the right thing and are not warned.
  const warning =
    node.parentId === null && node.createdBy === "agent"
      ? "pass --parent <id> to nest; `kalamu ls` walks the tree one level at a time"
      : undefined;
  const created = withLink(paths.root, node, `Created ${node.id}${location}`, { id: node.id, parentId: node.parentId, path });
  if (warning === undefined) return created;
  return { text: `${created.text}\nNote: ${warning}`, json: { ...created.json, warning } };
}

/**
 * Folds each blocker through `addBlocker` in turn, so every one gets the same
 * validation (existence, self-reference, cycles) as a standalone `kalamu
 * block`. Returns the blocked node's final state.
 */
function applyBlockers(
  nodes: KalamuNode[],
  node: KalamuNode,
  blockerIds: readonly string[],
): { nodes: KalamuNode[]; node: KalamuNode } {
  return blockerIds.reduce((acc, blockerId) => addBlocker(acc.nodes, acc.node.id, blockerId), { nodes, node });
}

export interface UpdateOptions {
  text?: string;
  kind?: string;
  p?: string;
  addTag?: string[];
  removeTag?: string[];
  assign?: string;
  by?: string;
}

export function update(cwd: string, id: string, options: UpdateOptions): CommandResult {
  const { text, kind, p, addTag, removeTag, assign, by } = options;
  if ([text, kind, p, assign, by].every((flag) => flag === undefined) && !addTag?.length && !removeTag?.length) {
    throw new CliError("nothing to do — pass --text, --kind, --p, --add-tag, --remove-tag, --assign, or --by");
  }
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) =>
    updateNode(nodes, id, {
      text,
      kind: kind !== undefined ? parseKind(kind) : undefined,
      priority: p !== undefined ? parsePriority(p, true) : undefined,
      addTags: addTag,
      removeTags: removeTag,
      assignee: assign !== undefined ? parseAssignee(assign, true) : undefined,
      // Unlike add, update never resolves an actor: provenance only changes
      // on an explicit --by (key decision 15's correction path).
      createdBy: by !== undefined ? parseActor(by) : undefined,
    }),
  );
  return { text: `Updated ${node.id}`, json: { id: node.id } };
}

export interface MoveOptions {
  parent?: string;
  after?: string;
  before?: string;
}

export function move(cwd: string, id: string, options: MoveOptions): CommandResult {
  if (options.parent === undefined && options.after === undefined && options.before === undefined) {
    throw new CliError("nothing to do — pass --parent, --after, or --before");
  }
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) =>
    moveNode(nodes, id, {
      // "--parent root" moves to top level.
      parentId: options.parent === undefined ? undefined : options.parent === "root" ? null : options.parent,
      afterId: options.after,
      beforeId: options.before,
    }),
  );
  return { text: `Moved ${node.id}`, json: { id: node.id, parentId: node.parentId } };
}

export function del(cwd: string, id: string, options: { recursive?: boolean }): CommandResult {
  const paths = resolvePaths(cwd);
  const { deletedCount: deleted } = withOutline(paths.outline, (nodes) =>
    deleteNode(nodes, id, { recursive: options.recursive }),
  );
  const suffix = deleted === 1 ? "" : ` (${deleted} nodes)`;
  return { text: `Deleted ${id}${suffix}`, json: { id, deleted } };
}

export function done(cwd: string, id: string): CommandResult {
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) => markDone(nodes, id));
  return withLink(paths.root, node, `Done ${node.id}`, { id: node.id, doneAt: node.doneAt });
}

export function reopen(cwd: string, id: string): CommandResult {
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) => reopenOp(nodes, id));
  return { text: `Reopened ${node.id}`, json: { id: node.id } };
}

export function start(cwd: string, id: string, options: { force?: boolean } = {}): CommandResult {
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) => startTask(nodes, id, { force: options.force }));
  return withLink(paths.root, node, `Started ${node.id}`, { id: node.id, startedAt: node.startedAt });
}

export function end(cwd: string, id: string): CommandResult {
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) => endTask(nodes, id));
  return { text: `Ended ${node.id} — back in the queue`, json: { id: node.id } };
}

export function block(cwd: string, id: string, options: { by?: string[] }): CommandResult {
  const blockers = options.by ?? [];
  if (blockers.length === 0) throw new CliError("--by <id> is required (repeatable)");
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) => {
    const target = nodes.find((n) => n.id === id);
    if (target === undefined) throw new CliError(`no node with id ${id}`, "not-found");
    return applyBlockers(nodes, target, blockers);
  });
  return {
    text: `Blocked ${node.id} by ${blockers.join(", ")}`,
    json: { id: node.id, blockedBy: node.blockedBy ?? [] },
  };
}

export function unblock(cwd: string, id: string, options: { by?: string }): CommandResult {
  const paths = resolvePaths(cwd);
  const { node } = withOutline(paths.outline, (nodes) => removeBlocker(nodes, id, options.by));
  const what = options.by !== undefined ? options.by : "all blockers";
  return { text: `Unblocked ${node.id} (${what})`, json: { id: node.id, blockedBy: node.blockedBy ?? [] } };
}

export interface ListOptions {
  tasks?: boolean;
  open?: boolean;
  done?: boolean;
  started?: boolean;
  blocked?: boolean;
  discussions?: boolean;
  assignee?: string;
  createdBy?: string;
  tag?: string;
  depth?: string;
  under?: string;
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`invalid value "${value}" — use a positive integer`);
  return n;
}

function listFilter(options: ListOptions): (node: KalamuNode) => boolean {
  // Flag values parse once, up front: a bad --assignee/--created-by must fail
  // loudly even when the outline is empty and the closure never runs.
  const assignee = options.assignee !== undefined ? parseAssignee(options.assignee, false) : undefined;
  const createdBy = options.createdBy !== undefined ? parseActor(options.createdBy) : undefined;
  return (node) => {
    if (options.tasks && node.kind !== "task") return false;
    if (options.open && !(node.kind === "task" && node.doneAt === null)) return false;
    if (options.done && !(node.kind === "task" && node.doneAt !== null)) return false;
    if (options.started && !(node.startedAt !== undefined && node.doneAt === null)) return false;
    if (options.blocked && !node.blockedBy?.length) return false;
    if (options.discussions && node.kind !== "discussion") return false;
    if (assignee !== undefined && node.assignee !== assignee) return false;
    // Human authorship is the absent default, so "human" means "no createdBy".
    if (createdBy !== undefined && (node.createdBy ?? "human") !== createdBy) return false;
    if (options.tag !== undefined && !deriveTags(node.text).includes(options.tag.toLowerCase())) return false;
    return true;
  };
}

export function list(cwd: string, options: ListOptions): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const tree = buildTree(nodes);
  const origin = options.under !== undefined ? tree.byId.get(options.under) : undefined;
  if (options.under !== undefined && origin === undefined) {
    throw new CliError(`no node with id ${options.under}`, "not-found");
  }
  const scope = origin !== undefined ? subtreeIds(tree, origin.id) : null;
  const originDepth = origin !== undefined ? depthOf(tree, origin) : 0;
  const base = listFilter(options);
  const maxDepth = options.depth !== undefined ? parsePositiveInt(options.depth) : undefined;
  const filter = (node: KalamuNode): boolean =>
    (scope === null || scope.has(node.id)) &&
    base(node) &&
    (maxDepth === undefined || depthOf(tree, node) - originDepth < maxDepth);
  const ordered = preorder(tree).filter(filter);
  return { text: renderOutline(nodes, filter), json: ordered.map((n) => withPath(tree, n)) };
}

function withPath(tree: Tree, node: KalamuNode): KalamuNode & { path: string[] } {
  return { ...node, path: pathOf(tree, node) };
}

export interface ShowOptions {
  children?: boolean;
  depth?: string;
  format?: string;
}

export function show(cwd: string, id: string, options: ShowOptions): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const tree = buildTree(nodes);
  const node = tree.byId.get(id);
  if (!node) throw new CliError(`no node with id ${id}`, "not-found");

  // --depth N: the node plus descendants up to N levels below it (implies --children).
  const maxDepth = options.depth !== undefined ? parsePositiveInt(options.depth) : undefined;
  const withChildren = options.children || maxDepth !== undefined;

  if (options.format === "markdown") {
    return { text: serializeMarkdown(tree, [node], withChildren ? maxDepth : 0), json: withPath(tree, node) };
  }
  if (!withChildren) {
    return { text: renderOutline(nodes, (n) => n.id === id), json: withPath(tree, node) };
  }
  const rootDepth = depthOf(tree, node);
  const ids = subtreeIds(tree, id);
  const inView = (n: KalamuNode): boolean =>
    ids.has(n.id) && (maxDepth === undefined || depthOf(tree, n) - rootDepth <= maxDepth);
  const children = preorder(tree).filter((n) => inView(n) && n.id !== id);
  return { text: renderOutline(nodes, inView), json: { ...withPath(tree, node), children } };
}

export interface LinkOptions {
  format?: string;
}

/** A copy-ready human reference to a node, backed by its stable hub URL. */
export function link(cwd: string, id: string, options: LinkOptions = {}): CommandResult {
  if (options.format !== undefined && !["markdown", "url", "json"].includes(options.format)) {
    throw new CliError(`invalid format "${options.format}" — use markdown, url or json`);
  }
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) throw new CliError(`no node with id ${id}`, "not-found");
  const slug = slugFor(paths.root);
  if (slug === undefined) {
    throw new CliError("could not resolve this project's hub slug — check that ~/.kalamu is writable");
  }
  const result = createNodeLink(node, slug, hubBaseUrl());
  return { text: options.format === "url" ? result.url : result.markdown, json: result };
}

export function search(cwd: string, query: string): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const tree = buildTree(nodes);
  const matches = searchNodes(nodes, query);
  const matchIds = new Set(matches.map((n) => n.id));
  return {
    text: matches.length ? renderOutline(nodes, (n) => matchIds.has(n.id)) : "No matches.",
    json: matches.map((n) => withPath(tree, n)),
  };
}

/**
 * One level of the outline — the directory listing an agent uses to walk to a
 * parent without dumping the whole tree. Omit `id` for top-level items;
 * pass an id for that node's direct children. `(N)` is the child count, so a
 * promising branch can be descended with another `ls` and a leaf is obvious.
 */
export function ls(cwd: string, id?: string): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const tree = buildTree(nodes);
  const parent = id !== undefined ? tree.byId.get(id) : undefined;
  if (id !== undefined && parent === undefined) throw new CliError(`no node with id ${id}`, "not-found");

  const children = tree.children.get(parent?.id ?? null) ?? [];
  const json = {
    id: parent?.id ?? null,
    text: parent?.text ?? null,
    // Root-to-here inclusive: this is the location whose children are listed.
    path: parent !== undefined ? [...pathOf(tree, parent), parent.text] : [],
    children: children.map((child) => ({
      ...child,
      childCount: (tree.children.get(child.id) ?? []).length,
    })),
  };

  if (children.length === 0) {
    const empty = parent !== undefined ? "(no children)" : "(empty)";
    const header = parent !== undefined ? `Path: ${json.path.join(" > ")}\n` : "";
    return { text: `${header}${empty}`, json };
  }

  const idWidth = Math.max(...children.map((n) => n.id.length));
  const lines = children.map((child) => {
    const count = (tree.children.get(child.id) ?? []).length;
    const tally = count > 0 ? `  (${count})` : "";
    return `${child.id.padEnd(idWidth)}  ${glyphFor(child)} ${prefixFor(child)}${child.text}${suffixFor(child)}${tally}`;
  });
  const header = parent !== undefined ? [`Path: ${json.path.join(" > ")}`] : [];
  return { text: [...header, ...lines].join("\n"), json };
}

export interface NextCommandOptions {
  limit?: string;
  all?: boolean;
  under?: string;
  /** Queue discussions instead of tasks (same eligibility/sort otherwise). */
  discussion?: boolean;
}

export function next(cwd: string, options: NextCommandOptions = {}): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const kind = options.discussion ? ("discussion" as const) : ("task" as const);
  const scope: NextOptions = { under: options.under, kind };

  // Batch mode: --all or --limit N returns the queue in next-order so an
  // agent can load several tasks into context at once.
  if (options.all || options.limit !== undefined) {
    const limit = options.limit !== undefined ? parsePositiveInt(options.limit) : undefined;
    const queue = eligibleTasks(nodes, scope).slice(0, options.all ? undefined : limit);
    if (!queue.length) return { text: `No eligible ${kind}s.`, json: { count: 0, tasks: [] }, exitCode: 2 };
    const linkTo = nodeLinker(paths.root);
    const entry = ({ node, path }: (typeof queue)[number]): Record<string, unknown> => {
      const link = linkTo(node);
      return { id: node.id, text: node.text, priority: effectivePriority(node), path, ...(link !== undefined ? { link } : {}) };
    };
    const text = queue
      .map(({ node, path }) => {
        const pathLine = path.length ? `\n${" ".repeat(node.id.length + 2)}Path: ${path.join(" > ")}` : "";
        return `${node.id}  ${glyphFor(node)} ${prefixFor(node)}${node.text}${pathLine}`;
      })
      .join("\n");
    return {
      text: `${text}\n${queue.length} ${kind}(s); sorted by priority (p1 first), then outline order`,
      json: { count: queue.length, tasks: queue.map(entry) },
    };
  }

  const result = nextTask(nodes, scope);
  if (!result) {
    return { text: `No eligible ${kind}s.`, json: { id: null }, exitCode: 2 };
  }
  // Single mode carries the task's full context for an agent: the ancestor
  // chain (root -> parent) and the task's own subtree, but never siblings.
  const tree = buildTree(nodes);
  const chain = ancestors(tree, result.node);
  const subtree = subtreeIds(tree, result.node.id);
  const descendants = preorder(tree).filter((n) => subtree.has(n.id) && n.id !== result.node.id);
  const taskDepth = depthOf(tree, result.node);

  const priority = effectivePriority(result.node);
  const lines = [`${result.node.id}  ${glyphFor(result.node)} ${prefixFor(result.node)}${result.node.text}`];
  if (result.path.length) lines.push(`Path: ${result.path.join(" > ")}`);
  for (const child of descendants) {
    const indent = "  ".repeat(depthOf(tree, child) - taskDepth);
    lines.push(`${indent}${glyphFor(child)} ${prefixFor(child)}${child.text}  (${child.id})`);
  }
  lines.push(`Reason: ${result.reason}`);
  return withLink(paths.root, result.node, lines.join("\n"), {
    id: result.node.id,
    text: result.node.text,
    priority,
    path: result.path,
    ancestors: chain.map((n) => ({ id: n.id, text: n.text, kind: n.kind })),
    descendants,
    reason: result.reason,
  });
}

export function clean(cwd: string, options: { dryRun?: boolean }): CommandResult {
  const paths = resolvePaths(cwd);
  const report = (result: ReturnType<typeof cleanDone>, dry: boolean): CommandResult => {
    const ids = result.removed.map((n) => n.id);
    const verb = dry ? "Would delete" : "Deleted";
    const detail = [
      result.doneTasks > 0 ? `${result.doneTasks} done task(s)` : "",
      result.doneBullets > 0 ? `${result.doneBullets} done bullet(s)` : "",
      result.doneDiscussions > 0 ? `${result.doneDiscussions} done discussion(s)` : "",
      result.blankNodes > 0 ? `${result.blankNodes} blank node(s)` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const text = ids.length ? `${verb} ${ids.length} node(s) (${detail})` : "Nothing to clean.";
    return {
      text,
      json: {
        deleted: ids.length,
        doneTasks: result.doneTasks,
        doneBullets: result.doneBullets,
        doneDiscussions: result.doneDiscussions,
        blankNodes: result.blankNodes,
        ids,
        dryRun: dry,
      },
    };
  };
  if (options.dryRun) {
    return report(cleanDone(readOutline(paths.outline).nodes), true);
  }
  return report(withOutline(paths.outline, cleanDone), false);
}

export function validate(cwd: string): CommandResult {
  const paths = resolvePaths(cwd);
  let content: string;
  try {
    content = readFileSync(paths.outline, "utf8");
  } catch {
    throw new CliError(`no outline at ${paths.outline} — run "kalamu init"`);
  }
  const result = validateOutline(content, { docExists: (path) => findDoc(paths.root, path) !== null });
  const lines: string[] = [];
  if (result.valid) lines.push(`Valid: ${result.nodes} nodes`);
  else lines.push(`Invalid: ${result.errors.length} error(s)`);
  for (const error of result.errors) lines.push(`  error: ${error}`);
  for (const warning of result.warnings) lines.push(`  warning: ${warning}`);
  return { text: lines.join("\n"), json: result, exitCode: result.valid ? 0 : 1 };
}
