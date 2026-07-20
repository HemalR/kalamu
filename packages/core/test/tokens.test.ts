import { describe, expect, it } from "vitest";
import { appendTags, deriveTags, parseTokens, stripTags } from "../src/tokens.js";

describe("parseTokens", () => {
  it("extracts p1-p3 and strips the token", () => {
    expect(parseTokens("Fix broken upload p1")).toMatchObject({ text: "Fix broken upload", priority: 1 });
    expect(parseTokens("p3 someday thing")).toMatchObject({ text: "someday thing", priority: 3 });
    expect(parseTokens("mid P2 token")).toMatchObject({ text: "mid token", priority: 2 });
  });

  it("does not parse invalid priority strings", () => {
    for (const text of ["upgrade to p10", "p4 backlog", "P5 someday", "P99 problems", "P256 hash", "loop", "stop3", "p3x marks"]) {
      const parsed = parseTokens(text);
      expect(parsed.priority).toBeUndefined();
      expect(parsed.text).toBe(text);
    }
  });

  it("p2 is reported so callers can treat it as explicit default", () => {
    expect(parseTokens("normal thing p2").priority).toBe(2);
  });

  it("last priority token wins", () => {
    expect(parseTokens("thing p3 p1")).toMatchObject({ priority: 1, text: "thing" });
  });

  it("derives #tags (lowercased, deduped) but leaves them in the text", () => {
    expect(parseTokens("Fix upload #Backend #backend #api-v2")).toMatchObject({
      text: "Fix upload #Backend #backend #api-v2",
      tags: ["backend", "api-v2"],
    });
    expect(parseTokens("Build a new #feature to do xyz")).toMatchObject({
      text: "Build a new #feature to do xyz",
      tags: ["feature"],
    });
    expect(parseTokens("issue#42 stays")).toMatchObject({ text: "issue#42 stays", tags: [] });
  });

  it("extracts @human/@agent as the assignee, never inside words", () => {
    expect(parseTokens("write blog post @human")).toMatchObject({ text: "write blog post", assignee: "human" });
    expect(parseTokens("migrate config @Agent")).toMatchObject({ text: "migrate config", assignee: "agent" });
    expect(parseTokens("last wins @human @agent")).toMatchObject({ text: "last wins", assignee: "agent" });
    expect(parseTokens("email me@human.com")).toMatchObject({ text: "email me@human.com" });
    expect(parseTokens("ping @humanoid")).toMatchObject({ text: "ping @humanoid" });
    expect(parseTokens("no token here").assignee).toBeUndefined();
  });

  it("collapses whitespace left by removed tokens, keeping tags", () => {
    expect(parseTokens("a p1 b #x c @human d").text).toBe("a b #x c d");
  });
});

describe("deriveTags / appendTags / stripTags", () => {
  it("derives in order of appearance", () => {
    expect(deriveTags("one #b two #a #b")).toEqual(["b", "a"]);
    expect(deriveTags("no tags here")).toEqual([]);
  });

  it("appendTags is idempotent and lowercases", () => {
    expect(appendTags("Fix upload", ["Backend", "backend"])).toBe("Fix upload #backend");
    expect(appendTags("Fix upload #backend", ["backend", "api"])).toBe("Fix upload #backend #api");
    expect(appendTags("", ["a"])).toBe("#a");
  });

  it("stripTags removes only whole tokens, case-insensitively", () => {
    expect(stripTags("Build a new #feature to do xyz", ["feature"])).toBe("Build a new to do xyz");
    expect(stripTags("keep issue#42 #Real", ["real"])).toBe("keep issue#42");
    expect(stripTags("no change", ["ghost"])).toBe("no change");
  });
});
