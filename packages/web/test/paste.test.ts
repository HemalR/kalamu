import { addNode, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import { applyPasteLines, pastedLineFields, splitPasteLines } from "../src/lib/paste";

const NOW = "2026-07-09T09:00:00.000Z";

function empty(kind: KalamuNode["kind"]): KalamuNode {
  return {
    id: "n_target",
    parentId: null,
    kind,
    text: "",
    createdAt: NOW,
    doneAt: null,
  };
}

describe("splitPasteLines", () => {
  it("returns null for a single line", () => {
    expect(splitPasteLines("just one")).toBeNull();
    expect(splitPasteLines("just one\n")).toBeNull();
    expect(splitPasteLines("\njust one\n\n")).toBeNull();
  });

  it("splits on newlines and drops blank lines", () => {
    expect(splitPasteLines("a\nb")).toEqual(["a", "b"]);
    expect(splitPasteLines("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
    expect(splitPasteLines("  a  \n\n\tb\t\n")).toEqual(["a", "b"]);
  });
});

describe("pastedLineFields", () => {
  it("keeps the given kind even when a priority token is present", () => {
    expect(pastedLineFields("bullet", "Ship it p1")).toEqual({ text: "Ship it", priority: 1 });
    expect(pastedLineFields("discussion", "Talk this through p3")).toEqual({
      text: "Talk this through",
      priority: 3,
    });
  });

  it("assigns only on tasks", () => {
    expect(pastedLineFields("task", "Do it @human")).toEqual({ text: "Do it", assignee: "human" });
    expect(pastedLineFields("bullet", "Do it @human")).toEqual({ text: "Do it" });
    expect(pastedLineFields("discussion", "Do it @agent")).toEqual({ text: "Do it" });
  });
});

describe("applyPasteLines", () => {
  it("fills the target and creates same-kind siblings after it", () => {
    const { nodes, lastId } = applyPasteLines([empty("task")], "n_target", ["one", "two", "three"], {
      parentId: null,
      afterId: "n_target",
      now: NOW,
    });
    expect(nodes.map((n) => ({ kind: n.kind, text: n.text }))).toEqual([
      { kind: "task", text: "one" },
      { kind: "task", text: "two" },
      { kind: "task", text: "three" },
    ]);
    expect(lastId).toBe(nodes[2]?.id);
  });

  it("does not convert a bullet when a line carries p1", () => {
    const { nodes } = applyPasteLines([empty("bullet")], "n_target", ["alpha p1", "beta p1"], {
      parentId: null,
      afterId: "n_target",
      now: NOW,
    });
    expect(nodes.map((n) => ({ kind: n.kind, text: n.text, priority: n.priority }))).toEqual([
      { kind: "bullet", text: "alpha", priority: 1 },
      { kind: "bullet", text: "beta", priority: 1 },
    ]);
  });

  it("inserts extras as children when asked (zoom-root paste)", () => {
    const parent = empty("discussion");
    const { nodes } = applyPasteLines([parent], "n_target", ["root", "child a", "child b"], {
      parentId: parent.id,
      now: NOW,
    });
    expect(nodes.map((n) => ({ parentId: n.parentId, kind: n.kind, text: n.text }))).toEqual([
      { parentId: null, kind: "discussion", text: "root" },
      { parentId: "n_target", kind: "discussion", text: "child a" },
      { parentId: "n_target", kind: "discussion", text: "child b" },
    ]);
  });

  it("places extras after the target among existing siblings", () => {
    const target = empty("bullet");
    const before = addNode([], { text: "keep first", now: NOW });
    const withTarget: KalamuNode[] = [
      before.node,
      { ...target, id: "n_target" },
      { id: "n_after", parentId: null, kind: "bullet", text: "keep last", createdAt: NOW, doneAt: null },
    ];
    const { nodes } = applyPasteLines(withTarget, "n_target", ["mid a", "mid b"], {
      parentId: null,
      afterId: "n_target",
      now: NOW,
    });
    expect(nodes.map((n) => n.text)).toEqual(["keep first", "mid a", "mid b", "keep last"]);
  });
});
