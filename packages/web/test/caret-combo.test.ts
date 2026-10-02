import { describe, expect, it } from "vitest";
import { CaretCombo, type ComboKind, type ComboOption } from "../src/lib/caret-combo.svelte";

const TAGS = ["bug", "build", "ui"];

/** Tags and assignees from fixed lists; files report `loading` until given. */
function combo(files: string[] | null = null): CaretCombo {
  return new CaretCombo({
    options(kind: ComboKind, filter: string): ComboOption[] {
      if (kind === "tag") return TAGS.filter((tag) => tag.startsWith(filter)).map((value) => ({ kind, value }));
      if (kind === "file") return (files ?? []).filter((path) => path.includes(filter)).map((value) => ({ kind, value }));
      return (["human", "agent"] as const).filter((value) => value.startsWith(filter)).map((value) => ({ kind, value }));
    },
    loading: (kind) => kind === "file" && files === null,
  });
}

/** A keydown stand-in; `prevented` records preventDefault. */
function key(name: string, mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}) {
  const event = {
    key: name,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

describe("CaretCombo.open", () => {
  it("opens only at a word boundary with a collapsed caret", () => {
    expect(combo().open("tag", "fix", 3)).toBe(false);
    expect(combo().open("tag", "fix ", 4)).toBe(true);
    expect(combo().open("tag", "", 0)).toBe(true);
    expect(combo().open("tag", "fix ", null)).toBe(false);
  });

  it("stays shut with nothing to offer, unless the list is still loading", () => {
    const empty = new CaretCombo({ options: () => [], loading: () => false });
    expect(empty.open("tag", "", 0)).toBe(false);
    expect(combo(null).open("file", "", 0)).toBe(true);
  });
});

describe("CaretCombo.handleKey", () => {
  it("narrows on matching characters and closes on a miss or a space", () => {
    const c = combo();
    c.open("tag", "", 0);
    expect(c.handleKey(key("b"))).toBe("pass");
    expect(c.matches.map((option) => option.value)).toEqual(["bug", "build"]);
    expect(c.handleKey(key("x"))).toBe("pass");
    expect(c.kind).toBeNull();

    c.open("tag", "", 0);
    c.handleKey(key(" "));
    expect(c.kind).toBeNull();
  });

  it("keeps narrowing a file list that has not loaded yet", () => {
    const c = combo(null);
    c.open("file", "", 0);
    c.handleKey(key("s"));
    expect(c.filter).toBe("s");
  });

  it("cycles the highlight with the arrows and picks on Enter", () => {
    const c = combo();
    c.open("tag", "", 0);
    const up = key("ArrowUp");
    expect(c.handleKey(up)).toBe("consumed");
    expect(up.prevented).toBe(true);
    expect(c.index).toBe(2);
    expect(c.handleKey(key("Enter"))).toEqual({ pick: { kind: "tag", value: "ui" } });
  });

  it("backspace shortens the filter, then closes on the trigger itself", () => {
    const c = combo();
    c.open("tag", "", 0);
    c.handleKey(key("b"));
    c.handleKey(key("Backspace"));
    expect(c.filter).toBe("");
    expect(c.kind).toBe("tag");
    c.handleKey(key("Backspace"));
    expect(c.kind).toBeNull();
  });

  it("closes on Escape and on structural keys", () => {
    const c = combo();
    c.open("tag", "", 0);
    expect(c.handleKey(key("Escape"))).toBe("consumed");
    expect(c.kind).toBeNull();
    c.open("tag", "", 0);
    expect(c.handleKey(key("Tab"))).toBe("pass");
    expect(c.kind).toBeNull();
  });
});

describe("CaretCombo.pick", () => {
  it("completes a tag in place", () => {
    const c = combo();
    c.open("tag", "fix ", 4);
    expect(c.pick({ kind: "tag", value: "build" }, "fix #bu", 7)).toEqual({ draft: "fix #build", caret: 10 });
    expect(c.kind).toBeNull();
  });

  it("completes a path with a trailing space", () => {
    const c = combo(["src/a.ts"]);
    c.open("file", "see ", 4);
    expect(c.pick({ kind: "file", value: "src/a.ts" }, "see @a more", 6)).toEqual({ draft: "see @src/a.ts  more", caret: 14 });
  });

  it("removes an assignee fragment and reports the assignee", () => {
    const c = combo();
    c.open("assign", "ship ", 5);
    expect(c.pick({ kind: "assign", value: "human" }, "ship /hu", 8)).toEqual({ draft: "ship ", caret: 5, assignee: "human" });
  });
});
