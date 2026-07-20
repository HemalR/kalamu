/**
 * All CLI commands as pure-ish testable functions: (cwd, options) -> CommandResult.
 * The commander wiring in index.ts only parses argv and prints.
 */
import {
  addNode,
  ancestors,
  buildTree,
  cleanDone,
  clearHandoff,
  deleteNode,
  deriveTags,
  effectivePriority,
  eligibleTasks,
  markDone,
  moveNode,
  nextTask,
  preorder,
  reopen as reopenOp,
  searchNodes,
  setHandoff,
  subtreeIds,
  updateNode,
  validateOutline,
  type Assignee,
  type KalamuNode,
  type NextOptions,
  type NodeKind,
} from "@kalamu/core";
import { initKalamu, readOutline, withOutline } from "@kalamu/core/store";
import { readFileSync } from "node:fs";
import { ensureAgentDocs } from "./agent-docs.js";
import { CliError, looksLikeRepo, resolvePaths, type CommandResult } from "./context.js";
import { ensureGitignore, IGNORE_ENTRIES } from "./gitignore.js";
import { registerProject } from "./registry.js";
import { glyphFor, prefixFor, renderOutline } from "./render.js";
import { seedTour } from "./tour.js";
import { depthOf, serializeMarkdown } from "@kalamu/core";

export type Priority = 1 | 2 | 3;

export function parsePriority(value: string, allowDefault: boolean): Priority | "default" {
  if (allowDefault && value === "default") return "default";
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new CliError(`invalid priority "${value}" — use 1 (high), 2 (medium) or 3 (low)${allowDefault ? ' or "default"' : ""}`);
  }
  return n as Priority;
}

export function parseKind(value: string): NodeKind {
  if (value !== "bullet" && value !== "task" && value !== "discussion") {
    throw new CliError(`invalid kind "${value}" — use bullet, task or discussion`);
  }
  return value;
}

export function parseAssignee(value: string, allowNone: boolean): Assignee | null {
  if (allowNone && value === "none") return null;
  if (value !== "human" && value !== "agent") {
    throw new CliError(`invalid assignee "${value}" — use human or agent${allowNone ? " (or none to clear)" : ""}`);
  }
  return value;
}

export function init(cwd: string, options: { agentDocs?: boolean; gitignore?: boolean } = {}): CommandResult {
  const { created, paths } = initKalamu(cwd);
  registerProject(paths.root);
  const docs = options.agentDocs === false ? [] : ensureAgentDocs(cwd);
  // Only write .gitignore where a repo marker exists — elsewhere init just
  // prints the entries as a suggestion (SPEC ".gitignore entries").
  const inRepo = looksLikeRepo(cwd);
  const ignores = options.gitignore === false || !inRepo ? [] : ensureGitignore(cwd);
  const lines = [
    ...(docs.length ? [`Added the agent standing instruction to ${docs.join(" and ")}.`] : []),
    ...(ignores.length ? [`Added ${ignores.length} .kalamu ignore entr${ignores.length === 1 ? "y" : "ies"} to .gitignore.`] : []),
  ];
  const json = { created, dir: paths.dir, agentDocs: docs, gitignore: ignores };
  if (!created) {
    return { text: [`Already initialised (${paths.dir})`, ...lines].join("\n"), json };
  }
  const suggestion =
    inRepo || options.gitignore === false
      ? []
      : ["", "Suggested .gitignore entries:", ...IGNORE_ENTRIES.map((entry) => `  ${entry}`)];
  const text = [`Initialised Kalamu in ${paths.dir}`, ...lines, ...suggestion].join("\n");
  return { text, json };
}

export function tour(cwd: string): CommandResult {
  const paths = resolvePaths(cwd);
  withOutline(paths.outline, (nodes) => {
    // Never mix demo content into a real outline.
    if (nodes.length > 0) throw new CliError("--tour only seeds a fresh, empty outline");
    return { nodes: seedTour(nodes), result: undefined };
  });
  return {
    text: "Seeded the onboarding tour — run `kalamu open` to take it.",
    json: { tour: true },
  };
}

export interface AddOptions {
  parent?: string;
  kind?: string;
  text: string;
  p?: string;
  tag?: string[];
  assign?: string;
  after?: string;
  before?: string;
}

export function add(cwd: string, options: AddOptions): CommandResult {
  const paths = resolvePaths(cwd);
  const node = withOutline(paths.outline, (nodes) => {
    const result = addNode(nodes, {
      parentId: options.parent,
      kind: options.kind !== undefined ? parseKind(options.kind) : undefined,
      text: options.text,
      priority: options.p !== undefined ? (parsePriority(options.p, false) as Priority) : undefined,
      tags: options.tag,
      assignee: options.assign !== undefined ? (parseAssignee(options.assign, false) as Assignee) : undefined,
      afterId: options.after,
      beforeId: options.before,
    });
    return { nodes: result.nodes, result: result.node };
  });
  return { text: `Created ${node.id}`, json: { id: node.id } };
}

export interface UpdateOptions {
  text?: string;
  kind?: string;
  p?: string;
  addTag?: string[];
  removeTag?: string[];
  assign?: string;
}

export function update(cwd: string, id: string, options: UpdateOptions): CommandResult {
  const paths = resolvePaths(cwd);
  const node = withOutline(paths.outline, (nodes) => {
    const result = updateNode(nodes, id, {
      text: options.text,
      kind: options.kind !== undefined ? parseKind(options.kind) : undefined,
      priority: options.p !== undefined ? parsePriority(options.p, true) : undefined,
      addTags: options.addTag,
      removeTags: options.removeTag,
      assignee: options.assign !== undefined ? parseAssignee(options.assign, true) : undefined,
    });
    return { nodes: result.nodes, result: result.node };
  });
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
  const node = withOutline(paths.outline, (nodes) => {
    const result = moveNode(nodes, id, {
      // "--parent root" moves to top level.
      parentId: options.parent === undefined ? undefined : options.parent === "root" ? null : options.parent,
      afterId: options.after,
      beforeId: options.before,
    });
    return { nodes: result.nodes, result: result.node };
  });
  return { text: `Moved ${node.id}`, json: { id: node.id, parentId: node.parentId } };
}

export function del(cwd: string, id: string, options: { recursive?: boolean }): CommandResult {
  const paths = resolvePaths(cwd);
  const deleted = withOutline(paths.outline, (nodes) => {
    const result = deleteNode(nodes, id, { recursive: options.recursive });
    return { nodes: result.nodes, result: result.deletedCount };
  });
  const suffix = deleted === 1 ? "" : ` (${deleted} nodes)`;
  return { text: `Deleted ${id}${suffix}`, json: { id, deleted } };
}

export function done(cwd: string, id: string): CommandResult {
  const paths = resolvePaths(cwd);
  const node = withOutline(paths.outline, (nodes) => {
    const result = markDone(nodes, id);
    return { nodes: result.nodes, result: result.node };
  });
  return { text: `Done ${node.id}`, json: { id: node.id, doneAt: node.doneAt } };
}

export function reopen(cwd: string, id: string): CommandResult {
  const paths = resolvePaths(cwd);
  const node = withOutline(paths.outline, (nodes) => {
    const result = reopenOp(nodes, id);
    return { nodes: result.nodes, result: result.node };
  });
  return { text: `Reopened ${node.id}`, json: { id: node.id } };
}

export function handoff(cwd: string, id: string, options: { target?: string; ref?: string }): CommandResult {
  if (!options.target || !options.ref) throw new CliError("both --target and --ref are required");
  const paths = resolvePaths(cwd);
  const node = withOutline(paths.outline, (nodes) => {
    const result = setHandoff(nodes, id, options.target ?? "", options.ref ?? "");
    return { nodes: result.nodes, result: result.node };
  });
  return {
    text: `Handed off ${node.id} → ${options.target}:${options.ref}`,
    json: { id: node.id, handoff: node.handoff },
  };
}

export function unhandoff(cwd: string, id: string): CommandResult {
  const paths = resolvePaths(cwd);
  const node = withOutline(paths.outline, (nodes) => {
    const result = clearHandoff(nodes, id);
    return { nodes: result.nodes, result: result.node };
  });
  return { text: `Cleared handoff on ${node.id}`, json: { id: node.id, handoff: null } };
}

export interface ListOptions {
  tasks?: boolean;
  open?: boolean;
  done?: boolean;
  handoff?: boolean;
  discussions?: boolean;
  assignee?: string;
  tag?: string;
  depth?: string;
}

function parsePositiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new CliError(`invalid value "${value}" — use a positive integer`);
  return n;
}

function listFilter(options: ListOptions): (node: KalamuNode) => boolean {
  return (node) => {
    if (options.tasks && node.kind !== "task") return false;
    if (options.open && !(node.kind === "task" && node.doneAt === null)) return false;
    if (options.done && !(node.kind === "task" && node.doneAt !== null)) return false;
    if (options.handoff && node.handoff === null) return false;
    if (options.discussions && node.kind !== "discussion") return false;
    if (options.assignee !== undefined && node.assignee !== parseAssignee(options.assignee, false)) return false;
    if (options.tag !== undefined && !deriveTags(node.text).includes(options.tag.toLowerCase())) return false;
    return true;
  };
}

export function list(cwd: string, options: ListOptions): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const tree = buildTree(nodes);
  const base = listFilter(options);
  const maxDepth = options.depth !== undefined ? parsePositiveInt(options.depth) : undefined;
  const filter = (node: KalamuNode): boolean =>
    base(node) && (maxDepth === undefined || depthOf(tree, node) < maxDepth);
  const ordered = preorder(tree).filter(filter);
  return { text: renderOutline(nodes, filter), json: ordered };
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
  if (!node) throw new CliError(`no node with id ${id}`);

  // --depth N: the node plus descendants up to N levels below it (implies --children).
  const maxDepth = options.depth !== undefined ? parsePositiveInt(options.depth) : undefined;
  const withChildren = options.children || maxDepth !== undefined;

  if (options.format === "markdown") {
    return { text: serializeMarkdown(tree, [node], withChildren ? maxDepth : 0), json: node };
  }
  if (!withChildren) {
    return { text: renderOutline(nodes, (n) => n.id === id), json: node };
  }
  const rootDepth = depthOf(tree, node);
  const ids = subtreeIds(tree, id);
  const inView = (n: KalamuNode): boolean =>
    ids.has(n.id) && (maxDepth === undefined || depthOf(tree, n) - rootDepth <= maxDepth);
  const children = preorder(tree).filter((n) => inView(n) && n.id !== id);
  return { text: renderOutline(nodes, inView), json: { ...node, children } };
}

export function search(cwd: string, query: string): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const matches = searchNodes(nodes, query);
  const matchIds = new Set(matches.map((n) => n.id));
  return {
    text: matches.length ? renderOutline(nodes, (n) => matchIds.has(n.id)) : "No matches.",
    json: matches,
  };
}

export interface NextCommandOptions {
  limit?: string;
  all?: boolean;
  under?: string;
  includeHandedOff?: boolean;
  /** Queue discussions instead of tasks (same eligibility/sort otherwise). */
  discussion?: boolean;
}

export function next(cwd: string, options: NextCommandOptions = {}): CommandResult {
  const paths = resolvePaths(cwd);
  const { nodes } = readOutline(paths.outline);
  const kind = options.discussion ? ("discussion" as const) : ("task" as const);
  const scope: NextOptions = { under: options.under, includeHandedOff: options.includeHandedOff, kind };

  // Batch mode: --all or --limit N returns the queue in next-order so an
  // agent can load several tasks into context at once.
  if (options.all || options.limit !== undefined) {
    const limit = options.limit !== undefined ? parsePositiveInt(options.limit) : undefined;
    const queue = eligibleTasks(nodes, scope).slice(0, options.all ? undefined : limit);
    if (!queue.length) return { text: `No eligible ${kind}s.`, json: { count: 0, tasks: [] }, exitCode: 2 };
    const entry = ({ node, path }: (typeof queue)[number]): Record<string, unknown> => ({
      id: node.id,
      text: node.text,
      priority: effectivePriority(node),
      path,
    });
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
  return {
    text: lines.join("\n"),
    json: {
      id: result.node.id,
      text: result.node.text,
      priority,
      path: result.path,
      ancestors: chain.map((n) => ({ id: n.id, text: n.text, kind: n.kind })),
      descendants,
      reason: result.reason,
    },
  };
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
  return withOutline(paths.outline, (nodes) => {
    const result = cleanDone(nodes);
    return { nodes: result.nodes, result: report(result, false) };
  });
}

export function validate(cwd: string): CommandResult {
  const paths = resolvePaths(cwd);
  let content: string;
  try {
    content = readFileSync(paths.outline, "utf8");
  } catch {
    throw new CliError(`no outline at ${paths.outline} — run "kalamu init"`);
  }
  const result = validateOutline(content);
  const lines: string[] = [];
  if (result.valid) lines.push(`Valid: ${result.nodes} nodes`);
  else lines.push(`Invalid: ${result.errors.length} error(s)`);
  for (const error of result.errors) lines.push(`  error: ${error}`);
  for (const warning of result.warnings) lines.push(`  warning: ${warning}`);
  return { text: lines.join("\n"), json: result, exitCode: result.valid ? 0 : 1 };
}
