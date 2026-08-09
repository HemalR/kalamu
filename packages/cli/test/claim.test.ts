/** CLI surface for start/end (key decision 17) and block/unblock (key decision 16). */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as commands from "../src/commands.js";

let cwd: string;

function addTask(text: string, extra: Partial<commands.AddOptions> = {}): string {
  return (commands.add(cwd, { text, kind: "task", ...extra }).json as { id: string }).id;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "kalamu-claim-"));
  process.env.KALAMU_REGISTRY = join(cwd, "test-registry.json");
  commands.init(cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("kalamu start / end", () => {
  it("claims a task, hides it from next, and releases it again", () => {
    const claimed = addTask("claim me", { p: "1" });
    const fallback = addTask("fallback", { p: "3" });

    commands.start(cwd, claimed);
    expect((commands.next(cwd).json as { id: string }).id).toBe(fallback);
    expect(commands.list(cwd, { started: true }).text).toContain("claim me");

    commands.end(cwd, claimed);
    expect((commands.next(cwd).json as { id: string }).id).toBe(claimed);
  });

  it("refuses a second claim without --force and allows it with", () => {
    const id = addTask("contended");
    commands.start(cwd, id);
    expect(() => commands.start(cwd, id)).toThrow(/pass --force/);
    expect(() => commands.start(cwd, id, { force: true })).not.toThrow();
  });

  it("renders a distinct glyph for a claimed task", () => {
    const id = addTask("in flight");
    expect(commands.list(cwd, {}).text).toContain("☐ p2 in flight");
    commands.start(cwd, id);
    expect(commands.list(cwd, {}).text).toContain("▶ p2 in flight");
  });

  it("errors when ending a task that was never started", () => {
    expect(() => commands.end(cwd, addTask("idle"))).toThrow(/never started/);
  });
});

describe("kalamu block / unblock", () => {
  it("blocks a task, hides it from next, and frees it when the blocker is done", () => {
    const blocked = addTask("needs the other thing", { p: "1" });
    const blocker = addTask("the other thing", { p: "3" });

    commands.block(cwd, blocked, { by: [blocker] });
    expect((commands.next(cwd).json as { id: string }).id).toBe(blocker);
    expect(commands.list(cwd, { blocked: true }).text).toContain("needs the other thing");

    commands.done(cwd, blocker);
    expect((commands.next(cwd).json as { id: string }).id).toBe(blocked);
  });

  it("accepts several blockers at once and clears them individually", () => {
    const blocked = addTask("waits on two");
    const a = addTask("a");
    const b = addTask("b");

    const result = commands.block(cwd, blocked, { by: [a, b] });
    expect((result.json as { blockedBy: string[] }).blockedBy).toEqual([a, b]);

    commands.unblock(cwd, blocked, { by: a });
    expect((commands.show(cwd, blocked, {}).json as { blockedBy?: string[] }).blockedBy).toEqual([b]);

    commands.unblock(cwd, blocked, {});
    expect((commands.show(cwd, blocked, {}).json as { blockedBy?: string[] }).blockedBy).toBeUndefined();
  });

  it("rejects cycles and requires --by", () => {
    const a = addTask("a");
    const b = addTask("b");
    commands.block(cwd, a, { by: [b] });
    expect(() => commands.block(cwd, b, { by: [a] })).toThrow(/cycle/);
    expect(() => commands.block(cwd, a, { by: [] })).toThrow(/--by/);
  });

  it("rejects blocking a node that does not exist", () => {
    expect(() => commands.block(cwd, "n_404", { by: [addTask("real")] })).toThrow(/no node with id/);
  });

  it("--blocked-by on add applies blockers at creation", () => {
    const blocker = addTask("first");
    const dependent = addTask("second", { blockedBy: [blocker] });
    expect(commands.next(cwd).json).toMatchObject({ id: blocker });
    expect((commands.show(cwd, dependent, {}).json as { blockedBy: string[] }).blockedBy).toEqual([blocker]);
  });

  it("deleting a blocker leaves no dangling reference and validates", () => {
    const blocked = addTask("dependent");
    const blocker = addTask("goes away");
    commands.block(cwd, blocked, { by: [blocker] });

    commands.del(cwd, blocker, {});
    expect((commands.show(cwd, blocked, {}).json as { blockedBy?: string[] }).blockedBy).toBeUndefined();
    expect(commands.validate(cwd).exitCode).toBeFalsy();
  });
});
