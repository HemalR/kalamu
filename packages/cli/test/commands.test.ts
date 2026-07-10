import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as commands from "../src/commands.js";
import { CliError } from "../src/context.js";

let cwd: string;

function addTask(text: string, extra: Partial<commands.AddOptions> = {}): string {
  const result = commands.add(cwd, { text, kind: "task", ...extra });
  return (result.json as { id: string }).id;
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "kalamu-cli-"));
  commands.init(cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("acceptance flow (SPEC MVP criteria)", () => {
  it("init + add + list + next + done + validate", () => {
    const parent = commands.add(cwd, { text: "Auth improvements", kind: "bullet" });
    const parentId = (parent.json as { id: string }).id;
    const taskId = addTask("Fix password reset redirect", { parent: parentId, p: "1" });

    const listing = commands.list(cwd, {});
    expect(listing.text).toContain("• Auth improvements");
    expect(listing.text).toContain("☐ p1 Fix password reset redirect");

    const next = commands.next(cwd);
    expect(next.json).toMatchObject({
      id: taskId,
      text: "Fix password reset redirect",
      priority: 1,
      path: ["Auth improvements"],
    });

    commands.done(cwd, taskId);
    expect(commands.next(cwd)).toMatchObject({ json: { id: null }, exitCode: 2 });

    const validation = commands.validate(cwd);
    expect(validation.json).toMatchObject({ valid: true, nodes: 2, errors: [] });

    // Priority stored only when non-default; p1 present in the raw file.
    const raw = readFileSync(join(cwd, ".kalamu", "outline.jsonl"), "utf8");
    expect(raw).toContain('"priority":1');
    expect(raw).not.toContain('"priority":3');
  });

  it("init never overwrites, and re-init reports it", () => {
    addTask("keep me");
    const again = commands.init(cwd);
    expect(again.json).toMatchObject({ created: false });
    expect(commands.list(cwd, {}).text).toContain("keep me");
  });
});

describe("filters and outputs", () => {
  it("list --tasks --open --tag --assignee filter correctly (tags derived from inline tokens)", () => {
    const a = addTask("open one", { tag: ["backend"] });
    const b = addTask("done one");
    addTask("mine", { assign: "human" });
    commands.add(cwd, { text: "a thought" });
    commands.done(cwd, b);

    expect((commands.list(cwd, { tasks: true }).json as unknown[]).length).toBe(3);
    expect((commands.list(cwd, { open: true }).json as { id: string }[]).map((n) => n.id)).toContain(a);
    expect((commands.list(cwd, { done: true }).json as { id: string }[]).map((n) => n.id)).toEqual([b]);
    expect((commands.list(cwd, { tag: "backend" }).json as { id: string }[]).map((n) => n.id)).toEqual([a]);
    expect((commands.list(cwd, { tag: "backend" }).json as { text: string }[])[0]?.text).toBe("open one #backend");
    expect((commands.list(cwd, { assignee: "human" }).json as { text: string }[])[0]?.text).toBe("mine");
    expect((commands.list(cwd, { assignee: "agent" }).json as unknown[]).length).toBe(0);
    expect(() => commands.list(cwd, { assignee: "robot" })).toThrow(/human or agent/);
  });

  it("next --limit and --all return the queue in order; plain next unchanged", () => {
    const p2 = addTask("second", { p: "2" });
    const p1 = addTask("first", { p: "1" });
    const p3 = addTask("third");
    addTask("mine", { assign: "human", p: "1" });

    const two = commands.next(cwd, { limit: "2" });
    expect(two.json).toMatchObject({ count: 2 });
    expect((two.json as { tasks: { id: string }[] }).tasks.map((t) => t.id)).toEqual([p1, p2]);

    const all = commands.next(cwd, { all: true });
    expect((all.json as { tasks: { id: string }[] }).tasks.map((t) => t.id)).toEqual([p1, p2, p3]);
    expect(all.text).toContain("3 task(s)");

    // plain next keeps its original single-object shape
    expect(commands.next(cwd)).toMatchObject({ json: { id: p1 } });
    expect(() => commands.next(cwd, { limit: "0" })).toThrow(/positive integer/);

    commands.done(cwd, p1);
    commands.done(cwd, p2);
    commands.done(cwd, p3);
    expect(commands.next(cwd, { all: true })).toMatchObject({ json: { count: 0 }, exitCode: 2 });
  });

  it("human-assigned tasks are skipped by next but visible in list", () => {
    addTask("mine urgent", { assign: "human", p: "1" });
    const other = addTask("theirs");
    expect(commands.next(cwd).json).toMatchObject({ id: other });
  });

  it("update --assign sets and clears the assignee", () => {
    const id = addTask("swap hands");
    commands.update(cwd, id, { assign: "agent" });
    expect((commands.show(cwd, id, {}).json as { assignee?: string }).assignee).toBe("agent");
    commands.update(cwd, id, { assign: "none" });
    expect((commands.show(cwd, id, {}).json as { assignee?: string }).assignee).toBeUndefined();
    expect(() => commands.update(cwd, id, { assign: "both" })).toThrow(/none to clear/);
  });

  it("show --children returns the subtree", () => {
    const parent = addTask("parent");
    const child = addTask("child", { parent });
    const shown = commands.show(cwd, parent, { children: true });
    expect((shown.json as { children: { id: string }[] }).children.map((n) => n.id)).toEqual([child]);
    expect(commands.show(cwd, parent, {}).json).toMatchObject({ id: parent });
    expect(() => commands.show(cwd, "n_missing", {})).toThrow(CliError);
  });

  it("search matches case-insensitively", () => {
    addTask("Fix OAuth redirect");
    expect((commands.search(cwd, "oauth").json as unknown[]).length).toBe(1);
    expect(commands.search(cwd, "nope").text).toBe("No matches.");
  });

  it("handoff renders arrow suffix and excludes from next", () => {
    const id = addTask("promote me", { p: "1" });
    const fallback = addTask("fallback");
    commands.handoff(cwd, id, { target: "github", ref: "https://github.com/x/1" });
    expect(commands.list(cwd, {}).text).toContain("→ github:https://github.com/x/1");
    expect(commands.next(cwd).json).toMatchObject({ id: fallback });
  });

  it("move and delete respect tree rules", () => {
    const a = commands.add(cwd, { text: "A" });
    const aId = (a.json as { id: string }).id;
    const child = addTask("A1", { parent: aId });
    expect(() => commands.move(cwd, aId, { parent: child })).toThrow(/descendant/);
    expect(() => commands.del(cwd, aId, {})).toThrow(/--recursive/);
    const deleted = commands.del(cwd, aId, { recursive: true });
    expect(deleted.json).toMatchObject({ deleted: 2 });
  });

  it("move to root works via --parent root", () => {
    const parent = addTask("p");
    const child = addTask("c", { parent });
    commands.move(cwd, child, { parent: "root" });
    const listed = commands.list(cwd, {}).json as { id: string; parentId: string | null }[];
    expect(listed.find((n) => n.id === child)?.parentId).toBeNull();
  });

  it("rejects invalid priority and kind with friendly errors", () => {
    expect(() => commands.add(cwd, { text: "x", p: "9" })).toThrow(/1 \(urgent\) to 5 \(low\)/);
    expect(() => commands.add(cwd, { text: "x", kind: "note" })).toThrow(/bullet or task/);
  });

  it("list --depth and show --depth limit levels; show --format markdown matches copy format", () => {
    const root = commands.add(cwd, { text: "Root" });
    const rootId = (root.json as { id: string }).id;
    const mid = addTask("Mid task", { parent: rootId, p: "1" });
    const leaf = addTask("Leaf", { parent: mid });
    commands.done(cwd, leaf);

    expect((commands.list(cwd, { depth: "1" }).json as unknown[]).length).toBe(1);
    expect((commands.list(cwd, { depth: "2" }).json as unknown[]).length).toBe(2);
    expect(() => commands.list(cwd, { depth: "0" })).toThrow(/positive integer/);

    const shallow = commands.show(cwd, rootId, { depth: "1" });
    expect((shallow.json as { children: unknown[] }).children.length).toBe(1);
    const deep = commands.show(cwd, rootId, { depth: "2" });
    expect((deep.json as { children: unknown[] }).children.length).toBe(2);

    const md = commands.show(cwd, rootId, { children: true, format: "markdown" });
    expect(md.text).toBe("- Root\n  - [ ] p1 Mid task\n    - [x] Leaf");
    const single = commands.show(cwd, rootId, { format: "markdown" });
    expect(single.text).toBe("- Root");
  });

  it("clean removes done subtrees; --dry-run previews without writing", () => {
    const doneParent = addTask("done umbrella");
    addTask("open child under done", { parent: doneParent });
    const open = addTask("still open");
    commands.done(cwd, doneParent);

    const dry = commands.clean(cwd, { dryRun: true });
    expect(dry.json).toMatchObject({ deleted: 2, doneTasks: 1, dryRun: true });
    expect((commands.list(cwd, {}).json as unknown[]).length).toBe(3); // nothing written

    const real = commands.clean(cwd, {});
    expect(real.json).toMatchObject({ deleted: 2, doneTasks: 1, dryRun: false });
    const remaining = commands.list(cwd, {}).json as { id: string }[];
    expect(remaining.map((n) => n.id)).toEqual([open]);

    expect(commands.clean(cwd, {}).text).toBe("Nothing to clean.");
  });

  it("errors outside a kalamu project", () => {
    const bare = mkdtempSync(join(tmpdir(), "kalamu-bare-"));
    try {
      expect(() => commands.list(bare, {})).toThrow(/kalamu init/);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});

describe("next context and scoping", () => {
  it("single mode returns ancestors (root-first) and the task's subtree", () => {
    const area = commands.add(cwd, { text: "Web UI", kind: "bullet" });
    const areaId = (area.json as { id: string }).id;
    const taskId = addTask("Build palette", { parent: areaId, p: "1" });
    const childId = addTask("Sub step", { parent: taskId });
    addTask("Sibling task elsewhere");

    const result = commands.next(cwd);
    const json = result.json as {
      id: string;
      ancestors: { id: string; text: string }[];
      descendants: { id: string }[];
    };
    expect(json.id).toBe(taskId);
    expect(json.ancestors).toEqual([{ id: areaId, text: "Web UI", kind: "bullet" }]);
    expect(json.descendants.map((d) => d.id)).toEqual([childId]);
    expect(result.text).toContain("Sub step");
    expect(result.text).toContain(`(${childId})`);
  });

  it("--under scopes next to a subtree", () => {
    const area = commands.add(cwd, { text: "CLI", kind: "bullet" });
    const areaId = (area.json as { id: string }).id;
    addTask("Urgent elsewhere", { p: "1" });
    const scopedId = addTask("Scoped task", { parent: areaId, p: "5" });

    expect((commands.next(cwd, { under: areaId }).json as { id: string }).id).toBe(scopedId);
    expect(() => commands.next(cwd, { under: "n_404" })).toThrow(/n_404/);
  });

  it("--include-handed-off readmits handed-off tasks; unhandoff makes it permanent", () => {
    const id = addTask("Promoted", { p: "1" });
    commands.handoff(cwd, id, { target: "github", ref: "#1" });

    expect(commands.next(cwd).exitCode).toBe(2);
    expect((commands.next(cwd, { includeHandedOff: true }).json as { id: string }).id).toBe(id);

    const cleared = commands.unhandoff(cwd, id);
    expect(cleared.json).toEqual({ id, handoff: null });
    expect((commands.next(cwd).json as { id: string }).id).toBe(id);
    expect(() => commands.unhandoff(cwd, id)).toThrow(/no handoff/);
  });
});

describe("init --tour", () => {
  it("seeds the tour: every task is human-assigned, next finds nothing, outline validates", () => {
    const dir = mkdtempSync(join(tmpdir(), "kalamu-tour-"));
    try {
      commands.init(dir);
      const result = commands.tour(dir);
      expect(result.json).toEqual({ tour: true });

      const listing = commands.list(dir, {});
      expect(listing.text).toContain("Welcome to Kalamu");
      const nodes = commands.list(dir, {}).json as { kind: string; assignee?: string }[];
      expect(nodes.length).toBeGreaterThanOrEqual(10);
      for (const node of nodes.filter((n) => n.kind === "task")) expect(node.assignee).toBe("human");

      expect(commands.next(dir).exitCode).toBe(2);
      expect(commands.validate(dir).exitCode).toBeFalsy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to seed a non-empty outline", () => {
    addTask("real work");
    expect(() => commands.tour(cwd)).toThrow(/fresh, empty outline/);
  });
});
