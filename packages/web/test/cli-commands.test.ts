import { describe, expect, it } from "vitest";
import { nodeCommands } from "../src/lib/cli-commands";

describe("nodeCommands", () => {
  it("offers the handoff template on tasks only", () => {
    const commands = nodeCommands({ serverId: "n_1", kind: "task", done: false, hasChildren: false });
    expect(commands).toEqual([
      "kalamu show n_1 --children",
      "kalamu done n_1",
      'kalamu handoff n_1 --target backlog --ref ""',
      'kalamu add --parent n_1 --kind task --text ""',
      "kalamu delete n_1",
    ]);
  });

  it("discussions get done/reopen, add-child, delete — never handoff (SPEC key decision 12)", () => {
    const open = nodeCommands({ serverId: "n_2", kind: "discussion", done: false, hasChildren: true });
    expect(open).toEqual([
      "kalamu show n_2 --children",
      "kalamu done n_2",
      'kalamu add --parent n_2 --kind task --text ""',
      "kalamu delete n_2 --recursive",
    ]);
    const done = nodeCommands({ serverId: "n_2", kind: "discussion", done: true, hasChildren: false });
    expect(done).toContain("kalamu reopen n_2");
    expect(done.join("\n")).not.toContain("handoff");
  });

  it("bullets also omit the task-only handoff", () => {
    const commands = nodeCommands({ serverId: "n_3", kind: "bullet", done: false, hasChildren: false });
    expect(commands.join("\n")).not.toContain("handoff");
  });
});
