import { describe, expect, it } from "vitest";
import { parseNumbering, renumber, stripNumbering, withNumbering } from "../src/numbering.js";
import { addNode, deleteNode, moveNode, updateNode } from "../src/operations.js";
import { bullet, task } from "./helpers.js";

const texts = (nodes: readonly { text: string }[]) => nodes.map((n) => n.text);

describe("parseNumbering", () => {
  it("matches digits, dot, then whitespace or end", () => {
    expect(parseNumbering("1. foo")).toEqual({ ordinal: 1, body: "foo" });
    expect(parseNumbering("12.")).toEqual({ ordinal: 12, body: "" });
    expect(parseNumbering("3.14 pie")).toBeNull();
    expect(parseNumbering("1.foo")).toBeNull();
    expect(parseNumbering("v1. foo")).toBeNull();
  });

  it("round-trips through withNumbering / stripNumbering", () => {
    expect(withNumbering("foo", 4)).toBe("4. foo");
    expect(withNumbering("9. foo", 4)).toBe("4. foo");
    expect(withNumbering("", 4)).toBe("4.");
    expect(stripNumbering("4. foo")).toBe("foo");
    expect(stripNumbering("foo")).toBe("foo");
  });
});

describe("renumber", () => {
  it("numbers consecutive numbered siblings 1..n and restarts after a gap", () => {
    const nodes = [
      bullet("a", { text: "7. one" }),
      bullet("b", { text: "7. two" }),
      bullet("c", { text: "plain" }),
      bullet("d", { text: "1. again" }),
      bullet("e", { text: "1.  spaced" }),
    ];
    expect(texts(renumber(nodes))).toEqual(["1. one", "2. two", "plain", "1. again", "2. spaced"]);
  });

  it("keeps lists per parent and preserves untouched node identity", () => {
    const nodes = [
      bullet("a", { text: "1. one" }),
      bullet("a1", { parentId: "a", text: "1. child" }),
      bullet("a2", { parentId: "a", text: "5. child" }),
      bullet("b", { text: "1. two" }),
    ];
    const out = renumber(nodes);
    expect(texts(out)).toEqual(["1. one", "1. child", "2. child", "2. two"]);
    expect(out[0]).toBe(nodes[0]);
    expect(out[1]).toBe(nodes[1]);
  });
});

describe("operations renumber on exit", () => {
  const list = [
    task("a", { text: "1. a" }),
    task("b", { text: "2. b" }),
    task("c", { text: "3. c" }),
  ];

  it("insert between siblings shifts the rest", () => {
    const { nodes, node } = addNode(list, { text: "1.", afterId: "a", kind: "task" });
    expect(node.text).toBe("2.");
    expect(texts(nodes)).toEqual(["1. a", "2.", "3. b", "4. c"]);
  });

  it("delete closes the gap", () => {
    expect(texts(deleteNode(list, "b").nodes)).toEqual(["1. a", "2. c"]);
  });

  it("move reorders and re-derives ordinals", () => {
    expect(texts(moveNode(list, "c", { beforeId: "a" }).nodes)).toEqual(["1. c", "2. a", "3. b"]);
  });

  it("un-numbering a middle item splits the list", () => {
    expect(texts(updateNode(list, "b", { text: "b" }).nodes)).toEqual(["1. a", "b", "1. c"]);
  });

  it("a typed ordinal is canonicalized to its position", () => {
    const { node } = updateNode(list, "c", { text: "99. c" });
    expect(node.text).toBe("3. c");
  });
});
