/**
 * The kalamu CLI's commands, rendered by the "CLI commands" sheet, plus the
 * per-node command builder behind the palette's "Copy CLI command" submenu.
 * Maintained by hand — must track packages/cli's command table and flags.
 */
import type { NodeKind } from "@kalamu/core";

export interface CliCommand {
  name: string;
  does: string;
}

export interface NodeCommandInput {
  /** The id as the server/CLI knows it — never the optimistic local alias. */
  serverId: string;
  kind: NodeKind;
  done: boolean;
  hasChildren: boolean;
}

/**
 * Ready-to-run CLI commands for one node, real id filled in. Done/reopen
 * apply to bullets and discussions too; handoff stays task-only (discussions
 * are never handed off — SPEC key decision 12).
 */
export function nodeCommands({ serverId, kind, done, hasChildren }: NodeCommandInput): string[] {
  const commands = [`kalamu show ${serverId} --children`];
  commands.push(done ? `kalamu reopen ${serverId}` : `kalamu done ${serverId}`);
  if (kind === "task") {
    commands.push(`kalamu handoff ${serverId} --target backlog --ref ""`);
  }
  commands.push(`kalamu add --parent ${serverId} --kind task --text ""`);
  // Plain delete refuses nodes with children.
  commands.push(`kalamu delete ${serverId}${hasChildren ? " --recursive" : ""}`);
  return commands;
}

export const CLI_COMMANDS: readonly CliCommand[] = [
  { name: "init", does: "Initialise Kalamu in the current directory" },
  { name: "open", does: "Start the local server and open the browser UI" },
  { name: "list", does: "List outline nodes" },
  { name: "show", does: "Show a node" },
  { name: "add", does: "Add a node" },
  { name: "update", does: "Update a node" },
  { name: "move", does: "Move a node — subtree moves with it" },
  { name: "delete", does: "Delete a node" },
  { name: "done", does: "Mark an item done — visual strikethrough on bullets" },
  { name: "reopen", does: "Reopen an item" },
  { name: "handoff", does: "Record that a task was promoted into another system" },
  { name: "unhandoff", does: "Clear a task's handoff record" },
  { name: "search", does: "Search node text" },
  { name: "next", does: "Print the next task for an agent" },
  { name: "all", does: "Print every eligible task (alias for next --all)" },
  { name: "clean", does: "Delete completed tasks and their subtrees" },
  { name: "validate", does: "Validate the outline file" },
];
