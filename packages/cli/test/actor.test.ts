/** Provenance resolution and the createdBy field (SPEC key decision 15). */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseActor, resolveActor } from "../src/actor.js";
import * as commands from "../src/commands.js";
import { CliError } from "../src/context.js";

let cwd: string;

function outline(): string {
  return readFileSync(join(cwd, ".kalamu", "outline.jsonl"), "utf8");
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "kalamu-actor-"));
  process.env.KALAMU_REGISTRY = join(cwd, "test-registry.json");
  delete process.env.KALAMU_ACTOR;
  commands.init(cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  delete process.env.KALAMU_ACTOR;
});

describe("parseActor", () => {
  it("accepts human and agent", () => {
    expect(parseActor("human")).toBe("human");
    expect(parseActor("agent")).toBe("agent");
  });

  // CliError specifically: run() catches it and prints a clean one-line
  // message, where an unknown error class would escape as a stack trace.
  it("rejects anything else with a CliError", () => {
    expect(() => parseActor("robot")).toThrow(CliError);
  });
});

describe("resolveActor precedence", () => {
  it("prefers the explicit flag over the environment", () => {
    process.env.KALAMU_ACTOR = "agent";
    expect(resolveActor("human")).toBe("human");
  });

  it("uses the environment when no flag is given", () => {
    process.env.KALAMU_ACTOR = "human";
    expect(resolveActor(undefined)).toBe("human");
  });

  it("ignores an unrecognised environment value rather than throwing", () => {
    process.env.KALAMU_ACTOR = "nonsense";
    // Falls through to the TTY heuristic; under vitest stdin is not a TTY.
    expect(resolveActor(undefined)).toBe("agent");
  });

  it("falls back to the TTY heuristic — non-interactive means agent", () => {
    expect(resolveActor(undefined)).toBe("agent");
  });
});

describe("createdBy on add", () => {
  it("is written for agent authorship", () => {
    commands.add(cwd, { text: "Agent's own follow-up", kind: "task", by: "agent" });
    expect(outline()).toContain('"createdBy":"agent"');
  });

  it("is omitted for human authorship — the default is never persisted", () => {
    commands.add(cwd, { text: "Human thought", kind: "bullet", by: "human" });
    expect(outline()).not.toContain("createdBy");
  });

  it("is independent of assignee", () => {
    commands.add(cwd, { text: "Agent asks the human", kind: "task", by: "agent", assign: "human" });
    const line = outline().trim().split("\n").at(-1) ?? "";
    expect(line).toContain('"assignee":"human"');
    expect(line).toContain('"createdBy":"agent"');
  });
});

describe("list --created-by", () => {
  beforeEach(() => {
    commands.add(cwd, { text: "Human bullet", kind: "bullet", by: "human" });
    commands.add(cwd, { text: "Agent task", kind: "task", by: "agent" });
  });

  it("matches agent-authored nodes", () => {
    const rows = commands.list(cwd, { createdBy: "agent" }).json as { text: string }[];
    expect(rows.map((n) => n.text)).toEqual(["Agent task"]);
  });

  it("treats an absent createdBy as human", () => {
    const rows = commands.list(cwd, { createdBy: "human" }).json as { text: string }[];
    expect(rows.map((n) => n.text)).toContain("Human bullet");
    expect(rows.map((n) => n.text)).not.toContain("Agent task");
  });
});

describe("createdBy never affects the agent queue", () => {
  it("agent-authored tasks are as eligible as human-authored ones", () => {
    const id = (commands.add(cwd, { text: "Agent's own work", kind: "task", by: "agent" }).json as { id: string }).id;
    expect((commands.next(cwd, {}).json as { id: string | null }).id).toBe(id);
  });
});
