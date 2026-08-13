import { describe, expect, it } from "vitest";
import { CLI_COMMANDS, nodeCommands, type NodeCommandInput } from "../src/lib/cli-commands";

function input(overrides: Partial<NodeCommandInput> = {}): NodeCommandInput {
  return { serverId: "n_1", done: false, hasChildren: false, isTask: true, started: false, ...overrides };
}

describe("nodeCommands", () => {
  it("offers show, link, done, start, add-child and delete on an open task", () => {
    expect(nodeCommands(input())).toEqual([
      "kalamu show n_1 --children",
      "kalamu ls n_1",
      "kalamu link n_1",
      "kalamu done n_1",
      "kalamu start n_1",
      'kalamu add --parent n_1 --kind task --text ""',
      "kalamu delete n_1",
    ]);
  });

  it("swaps done for reopen once the node is done", () => {
    const commands = nodeCommands(input({ serverId: "n_2", done: true }));
    expect(commands).toContain("kalamu reopen n_2");
    expect(commands.some((command) => command.startsWith("kalamu done"))).toBe(false);
  });

  it("deletes recursively when the node has children", () => {
    expect(nodeCommands(input({ serverId: "n_3", hasChildren: true }))).toContain("kalamu delete n_3 --recursive");
  });

  it("swaps start for end once the task is claimed", () => {
    const commands = nodeCommands(input({ serverId: "n_4", started: true }));
    expect(commands).toContain("kalamu end n_4");
    expect(commands.some((command) => command.startsWith("kalamu start"))).toBe(false);
  });

  it("offers end — but never start — on a done task that still carries a claim", () => {
    const commands = nodeCommands(input({ serverId: "n_5", done: true, started: true }));
    expect(commands).toContain("kalamu end n_5");
    expect(commands.some((command) => command.startsWith("kalamu start"))).toBe(false);
  });

  it("omits the claim pair entirely on a done task that was never started", () => {
    const commands = nodeCommands(input({ serverId: "n_6", done: true }));
    expect(commands.some((command) => /^kalamu (start|end)/.test(command))).toBe(false);
  });

  it("omits the claim pair on kinds that cannot be claimed", () => {
    const commands = nodeCommands(input({ serverId: "n_7", isTask: false }));
    expect(commands.some((command) => /^kalamu (start|end)/.test(command))).toBe(false);
  });
});

describe("CLI_COMMANDS", () => {
  it("lists the claim, blocker, and ls commands the CLI ships", () => {
    const names = CLI_COMMANDS.map((command) => command.name);
    expect(names).toEqual(expect.arrayContaining(["start", "end", "block", "unblock", "ls"]));
  });
});
