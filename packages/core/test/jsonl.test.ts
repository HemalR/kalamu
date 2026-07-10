import { describe, expect, it } from "vitest";
import { parseJsonl, serializeJsonl, serializeNode } from "../src/jsonl.js";
import { bullet, task } from "./helpers.js";

describe("parseJsonl", () => {
  it("parses valid lines in file order", () => {
    const content =
      '{"id":"n_001","parentId":null,"kind":"bullet","text":"A","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null,"handoff":null}\n' +
      '{"id":"n_002","parentId":"n_001","kind":"task","text":"B","createdAt":"2026-07-09T07:01:00.000Z","doneAt":null,"handoff":null,"priority":1}\n';
    const { nodes, errors } = parseJsonl(content);
    expect(errors).toEqual([]);
    expect(nodes.map((n) => n.id)).toEqual(["n_001", "n_002"]);
    expect(nodes[1]?.priority).toBe(1);
  });

  it("reports invalid JSON lines without aborting", () => {
    const content =
      "not json\n" +
      '{"id":"n_001","parentId":null,"kind":"bullet","text":"A","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null,"handoff":null}\n';
    const { nodes, errors } = parseJsonl(content);
    expect(nodes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
  });

  it("rejects unknown kind, bad priority, self:false", () => {
    const base = '"parentId":null,"text":"x","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null,"handoff":null';
    const bad = [
      `{"id":"a","kind":"note",${base}}`,
      `{"id":"b","kind":"task",${base},"priority":6}`,
      `{"id":"c","kind":"task",${base},"priority":0}`,
      `{"id":"f","kind":"task",${base},"self":false}`,
    ].join("\n");
    const { nodes, errors } = parseJsonl(bad);
    expect(nodes).toHaveLength(0);
    expect(errors).toHaveLength(4);
  });

  it("merges legacy tags arrays into the text and drops the field", () => {
    const base = '"parentId":null,"kind":"task","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null,"handoff":null';
    const legacy = [
      `{"id":"a","text":"Fix upload",${base},"tags":["backend","api"]}`,
      `{"id":"b","text":"Already has #backend",${base},"tags":["backend"]}`,
      `{"id":"c","text":"skip invalid",${base},"tags":["Has Space","ok"]}`,
    ].join("\n");
    const { nodes, errors } = parseJsonl(legacy);
    expect(errors).toEqual([]);
    expect(nodes.map((n) => n.text)).toEqual([
      "Fix upload #backend #api",
      "Already has #backend",
      "skip invalid #ok",
    ]);
    expect(nodes.every((n) => !("tags" in n))).toBe(true);
  });

  it("skips blank lines", () => {
    const { nodes, errors } = parseJsonl("\n\n");
    expect(nodes).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("serializeNode", () => {
  it("emits stable key order and omits absent optionals", () => {
    const line = serializeNode(task("n_001", { text: "Fix it" }));
    expect(line).toBe(
      '{"id":"n_001","parentId":null,"kind":"task","text":"Fix it","createdAt":"2026-07-09T07:00:00.000Z","doneAt":null,"handoff":null}',
    );
    expect(line).not.toContain("priority");
    expect(line).not.toContain("self");
  });

  it("round-trips through parse", () => {
    const nodes = [
      bullet("n_001"),
      task("n_002", { parentId: "n_001", text: "Fix #backend upload", priority: 1, self: true }),
    ];
    const { nodes: parsed, errors } = parseJsonl(serializeJsonl(nodes));
    expect(errors).toEqual([]);
    expect(parsed).toEqual(nodes);
  });

  it("ends the file with a trailing newline", () => {
    expect(serializeJsonl([bullet("n_001")]).endsWith("\n")).toBe(true);
    expect(serializeJsonl([])).toBe("");
  });
});
