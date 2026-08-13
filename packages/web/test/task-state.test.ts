import { buildTree, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import {
  blockedTitle,
  blockerCandidates,
  blockerEntries,
  candidateLabel,
  isAssignable,
  isBlockable,
  isStarted,
  nodeLabel,
  openBlockers,
} from "../src/lib/task-state";

function node(overrides: Partial<KalamuNode> & { id: string }): KalamuNode {
  return {
    parentId: null,
    kind: "task",
    text: "",
    createdAt: "2026-07-09T00:00:00.000Z",
    doneAt: null,
    ...overrides,
  };
}

const STARTED = "2026-08-09T09:00:00.000Z";
const DONE = "2026-08-09T10:00:00.000Z";

describe("isStarted", () => {
  it("is true only for a claimed task that is still open", () => {
    expect(isStarted(node({ id: "a", startedAt: STARTED }))).toBe(true);
    expect(isStarted(node({ id: "b" }))).toBe(false);
  });

  it("is false once the task is done — startedAt stays as a record of the work", () => {
    expect(isStarted(node({ id: "c", startedAt: STARTED, doneAt: DONE }))).toBe(false);
  });

  it("is false on other kinds, which cannot be claimed", () => {
    expect(isStarted(node({ id: "d", kind: "bullet", startedAt: STARTED }))).toBe(false);
    expect(isStarted(node({ id: "e", kind: "discussion", startedAt: STARTED }))).toBe(false);
  });
});

describe("isBlockable", () => {
  it("covers tasks and discussions, but not bullets", () => {
    expect(isBlockable(node({ id: "a" }))).toBe(true);
    expect(isBlockable(node({ id: "b", kind: "discussion" }))).toBe(true);
    expect(isBlockable(node({ id: "c", kind: "bullet" }))).toBe(false);
  });

  it("does not depend on done state — a done item can still record what it waited on", () => {
    expect(isBlockable(node({ id: "a", doneAt: DONE }))).toBe(true);
  });
});

describe("isAssignable", () => {
  it("covers tasks and promotable bullets, but not discussions", () => {
    expect(isAssignable(node({ id: "a" }))).toBe(true);
    expect(isAssignable(node({ id: "b", kind: "bullet" }))).toBe(true);
    expect(isAssignable(node({ id: "c", kind: "discussion" }))).toBe(false);
  });
});

describe("openBlockers", () => {
  const open = node({ id: "open", text: "Ship the API" });
  const closed = node({ id: "closed", text: "Write docs", doneAt: DONE });
  const waits = node({ id: "waits", text: "Launch", blockedBy: ["closed", "open"] });
  const settled = node({ id: "settled", text: "Announce", blockedBy: ["closed"] });
  const dangling = node({ id: "dangling", text: "Orphaned", blockedBy: ["n_gone"] });
  const free = node({ id: "free", text: "Nothing to wait for" });
  const tree = buildTree([open, closed, waits, settled, dangling, free]);

  it("keeps only blockers that are still open", () => {
    expect(openBlockers(tree, waits)).toEqual([open]);
  });

  it("treats a task whose blockers are all done as not blocked", () => {
    expect(openBlockers(tree, settled)).toEqual([]);
  });

  it("ignores a blocker id that no longer exists, so nothing is stranded", () => {
    expect(openBlockers(tree, dangling)).toEqual([]);
  });

  it("returns nothing when the field is absent", () => {
    expect(openBlockers(tree, free)).toEqual([]);
  });

  it("blocks a discussion the same way, so the Blocked badge renders on it", () => {
    const talk = node({ id: "talk", kind: "discussion", text: "Decide the schema", blockedBy: ["open"] });
    expect(openBlockers(buildTree([open, talk]), talk)).toEqual([open]);
  });
});

describe("nodeLabel", () => {
  it("trims the text and names an empty node", () => {
    expect(nodeLabel(node({ id: "a", text: "  Ship the API  " }))).toBe("Ship the API");
    expect(nodeLabel(node({ id: "b", text: "   " }))).toBe("(empty item)");
  });
});

describe("blockedTitle", () => {
  it("counts the blockers and lists what the task waits on", () => {
    expect(blockedTitle([node({ id: "a", text: "Ship the API" })])).toBe("Blocked by 1 open item:\nShip the API");
    expect(blockedTitle([node({ id: "a", text: "Ship the API" }), node({ id: "b", text: "Write docs" })])).toBe(
      "Blocked by 2 open items:\nShip the API\nWrite docs",
    );
  });
});

describe("blockerCandidates", () => {
  const api = node({ id: "a", text: "Ship the API" });
  const docs = node({ id: "b", text: "Write docs", doneAt: DONE });
  const launch = node({ id: "target", text: "Launch", blockedBy: ["a"] });
  const bullet = node({ id: "c", kind: "bullet", text: "Any kind may block" });
  const nodes = [api, docs, launch, bullet];

  it("offers every other node, minus the blockers already recorded", () => {
    expect(blockerCandidates(nodes, launch).map((n) => n.id)).toEqual(["c", "b"]);
  });

  it("never offers the node itself", () => {
    expect(blockerCandidates(nodes, api).map((n) => n.id)).toEqual(["target", "c", "b"]);
  });

  it("never offers an ancestor — a child cannot wait on one", () => {
    const parent = node({ id: "parent", text: "Webhook work" });
    const child = node({ id: "child", parentId: "parent", text: "Then validate" });
    const cousin = node({ id: "cousin", text: "Unrelated" });
    expect(blockerCandidates([parent, child, cousin], child).map((n) => n.id)).toEqual(["cousin"]);
  });

  it("leads with open tasks, then open other kinds, then done nodes", () => {
    const doneBullet = node({ id: "done-bullet", kind: "bullet", text: "Old note", doneAt: DONE });
    const discussion = node({ id: "discussion", kind: "discussion", text: "Talk it through" });
    const openTask = node({ id: "open-task", text: "Ship it" });
    const pool = [docs, doneBullet, discussion, bullet, openTask];
    expect(blockerCandidates(pool, launch).map((n) => n.id)).toEqual([
      "open-task",
      "discussion",
      "c",
      "b",
      "done-bullet",
    ]);
  });

  it("offers the same pool when the blocked node is a discussion", () => {
    const talk = node({ id: "talk", kind: "discussion", text: "Decide the schema" });
    expect(blockerCandidates([api, docs, talk, bullet], talk).map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("keeps outline order within a group", () => {
    const first = node({ id: "first", text: "First" });
    const second = node({ id: "second", text: "Second" });
    expect(blockerCandidates([first, second], launch).map((n) => n.id)).toEqual(["first", "second"]);
  });
});

describe("candidateLabel", () => {
  it("names an empty node, exactly as nodeLabel does", () => {
    expect(candidateLabel(node({ id: "a", text: "  " }))).toBe("(empty item)");
  });

  it("shortens at a summary boundary when the text has one", () => {
    expect(candidateLabel(node({ id: "a", text: "Ship the API to staging: it needs the new token endpoint" }))).toBe(
      "Ship the API to staging",
    );
  });

  it("caps a long unsummarizable text at 80 characters and ellipsizes", () => {
    const label = candidateLabel(node({ id: "a", text: `${"word ".repeat(40)}end` }));
    expect(label.length).toBeLessThanOrEqual(81); // 80 + the ellipsis
    expect(label.endsWith("…")).toBe(true);
  });
});

describe("blockerEntries", () => {
  const open = node({ id: "open", text: "Ship the API" });
  const closed = node({ id: "closed", text: "  ", doneAt: DONE });
  const waits = node({ id: "waits", text: "Launch", blockedBy: ["open", "closed", "n_gone"] });
  const free = node({ id: "free", text: "Nothing to wait for" });
  const tree = buildTree([open, closed, waits, free]);

  it("lists every recorded blocker, marking which ones are still open", () => {
    expect(blockerEntries(tree, waits)).toEqual([
      { id: "open", label: "Ship the API", open: true },
      { id: "closed", label: "(empty item)", open: false },
      { id: "n_gone", label: "n_gone (missing)", open: false },
    ]);
  });

  it("is empty when nothing is recorded", () => {
    expect(blockerEntries(tree, free)).toEqual([]);
  });
});
