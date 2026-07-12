import { parseTokens, type KalamuNode } from "@kalamu/core";
import { describe, expect, it } from "vitest";
import { commitPatch, tokenBeforeCaret, tokenPatch } from "../src/lib/commit";

function task(overrides: Partial<KalamuNode> = {}): KalamuNode {
  return {
    id: "n_test",
    parentId: null,
    kind: "task",
    text: "Fix upload",
    createdAt: "2026-07-09T00:00:00.000Z",
    doneAt: null,
    handoff: null,
    ...overrides,
  };
}

describe("commitPatch priority override", () => {
  // Regression: a p2 token on a task that already stored p4 must end up p2,
  // never cleared.
  it("token overrides an existing stored priority", () => {
    expect(commitPatch(task({ priority: 4 }), "Fix upload p2")).toEqual({ priority: 2 });
  });

  it("token sets priority when none is stored", () => {
    expect(commitPatch(task(), "Fix upload p1")).toEqual({ priority: 1 });
  });

  it("p3 token clears a stored priority to default", () => {
    expect(commitPatch(task({ priority: 4 }), "Fix upload p3")).toEqual({ priority: "default" });
  });

  it("p3 token with no stored priority is a no-op", () => {
    expect(commitPatch(task(), "Fix upload p3")).toBeNull();
  });

  it("token equal to the stored priority is a no-op", () => {
    expect(commitPatch(task({ priority: 4 }), "Fix upload p4")).toBeNull();
  });

  it("re-committing an already-committed draft is a no-op", () => {
    // The blur that follows an Enter commit re-runs with the stale raw draft;
    // the second pass must produce no patch.
    const before = task({ priority: 4 });
    expect(commitPatch(before, "Fix upload p2")).toEqual({ priority: 2 });
    const after = task({ priority: 2 });
    expect(commitPatch(after, "Fix upload p2")).toBeNull();
  });

  it("last priority token wins", () => {
    expect(commitPatch(task({ priority: 4 }), "Fix upload p1 p2")).toEqual({ priority: 2 });
  });
});

describe("commitPatch text, tags, assignee", () => {
  it("keeps #tags in the text verbatim while extracting pN", () => {
    // Tags are prose (SPEC key decision 7): the token IS the tag.
    expect(commitPatch(task({ text: "" }), "Build a new #feature to do xyz")).toEqual({
      text: "Build a new #feature to do xyz",
    });
    expect(commitPatch(task(), "Fix upload now p2 #backend")).toEqual({
      text: "Fix upload now #backend",
      priority: 2,
    });
  });

  it("a #tag-only edit patches text alone", () => {
    expect(commitPatch(task(), "Fix upload #backend")).toEqual({ text: "Fix upload #backend" });
  });

  it("@human/@agent set the assignee on tasks only, and are stripped", () => {
    expect(commitPatch(task(), "Fix upload @human")).toEqual({ assignee: "human" });
    expect(commitPatch(task(), "Fix upload @agent")).toEqual({ assignee: "agent" });
    expect(commitPatch(task({ assignee: "human" }), "Fix upload @agent")).toEqual({ assignee: "agent" });
    expect(commitPatch(task({ assignee: "human" }), "Fix upload @human")).toBeNull();
    expect(commitPatch(task({ kind: "bullet" }), "Fix upload @human")).toBeNull();
  });

  it("plain text edit patches text only", () => {
    expect(commitPatch(task(), "Fix uploads")).toEqual({ text: "Fix uploads" });
  });

  it("unchanged text is a no-op", () => {
    expect(commitPatch(task({ text: "Ship #api docs" }), "Ship #api docs")).toBeNull();
  });
});

describe("tokenPatch (parse-on-space)", () => {
  it("applies a priority token against the node", () => {
    expect(tokenPatch(task({ priority: 4 }), parseTokens("p2"))).toEqual({ priority: 2 });
  });

  it("never patches anything for #tags", () => {
    expect(tokenPatch(task(), parseTokens("#backend"))).toEqual({});
  });
});

describe("discussions (SPEC key decision 12)", () => {
  it("a priority token patches priority alone — never the kind", () => {
    expect(commitPatch(task({ kind: "discussion" }), "Fix upload p2")).toEqual({ priority: 2 });
    expect(tokenPatch(task({ kind: "discussion", priority: 4 }), parseTokens("p1"))).toEqual({ priority: 1 });
  });

  it("@human/@agent are dropped on discussions, exactly like bullets", () => {
    expect(commitPatch(task({ kind: "discussion" }), "Fix upload @human")).toBeNull();
    expect(tokenPatch(task({ kind: "discussion" }), parseTokens("@agent"))).toEqual({});
  });
});

describe("tokenBeforeCaret", () => {
  it("finds a priority token before the caret", () => {
    const hit = tokenBeforeCaret("Fix upload p2", 13);
    expect(hit?.parsed.priority).toBe(2);
    expect(hit?.start).toBe(11);
  });

  it("finds @human and @agent", () => {
    expect(tokenBeforeCaret("Fix @human", 10)?.parsed.assignee).toBe("human");
    expect(tokenBeforeCaret("Fix @agent", 10)?.parsed.assignee).toBe("agent");
  });

  it("does NOT match #tags — they stay in the text", () => {
    expect(tokenBeforeCaret("Fix #backend upload", 12)).toBeNull();
  });

  it("ignores ordinary words and near-tokens", () => {
    expect(tokenBeforeCaret("Fix upload", 10)).toBeNull();
    expect(tokenBeforeCaret("Fix p10", 7)).toBeNull();
    expect(tokenBeforeCaret("Fix supper2", 11)).toBeNull();
    expect(tokenBeforeCaret("", 0)).toBeNull();
  });

  it("only examines the word immediately before the caret", () => {
    // p1 earlier in the text must not be touched when the caret is elsewhere.
    expect(tokenBeforeCaret("p1 Fix upload", 13)).toBeNull();
  });
});
