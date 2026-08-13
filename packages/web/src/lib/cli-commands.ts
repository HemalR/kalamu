/**
 * The kalamu CLI's commands, rendered by the "CLI commands" sheet, plus the
 * per-node command builder behind the palette's "Copy CLI command" submenu.
 * Maintained by hand — must track packages/cli's command table and flags.
 */
export interface CliCommand {
  name: string;
  does: string;
}

export interface NodeCommandInput {
  /** The id as the server/CLI knows it — never the optimistic local alias. */
  serverId: string;
  done: boolean;
  hasChildren: boolean;
  /** Tasks alone can be claimed — `start`/`end` refuse other kinds. */
  isTask: boolean;
  /** Whether a claim is recorded (`startedAt`), done or not. */
  started: boolean;
}

/**
 * Ready-to-run CLI commands for one node, real id filled in. Every command
 * applies to every kind — done/reopen included (on bullets it is visual only)
 * — except the claim pair, which core refuses on anything but a task.
 *
 * Both of those pairs are also state-dependent: only the line that would do
 * something is offered — reopen for a done node and done otherwise, end for a
 * claimed task and start for an open unclaimed one.
 *
 * `block` is deliberately absent: it needs a second node's id, so it could
 * only be a template, not a ready-to-run line. The palette's "Block on…"
 * covers it with a picker.
 */
export function nodeCommands({ serverId, done, hasChildren, isTask, started }: NodeCommandInput): string[] {
  const commands = [`kalamu show ${serverId} --children`, `kalamu ls ${serverId}`, `kalamu link ${serverId}`];
  commands.push(done ? `kalamu reopen ${serverId}` : `kalamu done ${serverId}`);
  // A claim can be released even after the task is done; claiming a done task
  // is refused (reopen it first), so that line is simply not offered.
  if (isTask && started) commands.push(`kalamu end ${serverId}`);
  else if (isTask && !done) commands.push(`kalamu start ${serverId}`);
  commands.push(`kalamu add --parent ${serverId} --kind task --text ""`);
  // Plain delete refuses nodes with children.
  commands.push(`kalamu delete ${serverId}${hasChildren ? " --recursive" : ""}`);
  return commands;
}

export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: "init", does: "Initialise Kalamu in the current directory" },
  { name: "open", does: "Start the local server and open the browser UI" },
  { name: "list", does: "List outline nodes" },
  { name: "ls", does: "List one level of the outline — walk the tree without reading it all" },
  { name: "show", does: "Show a node" },
  { name: "link", does: "Print a human-readable deep link to a node" },
  { name: "add", does: "Add a node" },
  { name: "update", does: "Update a node" },
  { name: "move", does: "Move a node — subtree moves with it" },
  { name: "delete", does: "Delete a node" },
  { name: "done", does: "Mark an item done — visual strikethrough on bullets" },
  { name: "reopen", does: "Reopen an item" },
  { name: "start", does: "Claim a task so another agent session does not take it" },
  { name: "end", does: "Release a claim, returning the task to the queue" },
  { name: "block", does: "Record that a task or discussion waits on another node" },
  { name: "unblock", does: "Remove one blocker, or all of them" },
  { name: "search", does: "Search node text" },
  { name: "next", does: "Print the next task for an agent" },
  { name: "all", does: "Print every eligible task (alias for next --all)" },
  { name: "clean", does: "Delete completed tasks and their subtrees" },
  { name: "validate", does: "Validate the outline file" },
];
