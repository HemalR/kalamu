import { describe, expect, it } from "vitest";
import { parseFindIntent, resolveNodeId } from "../src/lib/find";

describe("parseFindIntent", () => {
  it("treats whitespace-only as empty", () => {
    expect(parseFindIntent("")).toEqual({ kind: "empty" });
    expect(parseFindIntent("  \n")).toEqual({ kind: "empty" });
  });

  it("classifies a bare id, including common wrappers", () => {
    expect(parseFindIntent("n_0JC1YXY9BV")).toEqual({ kind: "id", token: "n_0JC1YXY9BV" });
    expect(parseFindIntent("  n_001  ")).toEqual({ kind: "id", token: "n_001" });
    expect(parseFindIntent("(n_001)")).toEqual({ kind: "id", token: "n_001" });
    expect(parseFindIntent("`n_001`")).toEqual({ kind: "id", token: "n_001" });
    expect(parseFindIntent('"n_001"')).toEqual({ kind: "id", token: "n_001" });
  });

  it("pulls the id out of a kalamu link, URL, or markdown", () => {
    expect(parseFindIntent("#z=n_001")).toEqual({ kind: "id", token: "n_001" });
    expect(parseFindIntent("http://localhost:4400/p/kalamu#z=n_001")).toEqual({
      kind: "id",
      token: "n_001",
    });
    expect(
      parseFindIntent("[Fix login](http://localhost:4400/p/kalamu#z=n_0JC1YXY9BV) (n_0JC1YXY9BV)"),
    ).toEqual({ kind: "id", token: "n_0JC1YXY9BV" });
  });

  it("leaves mixed prose as a text search even when it mentions an id", () => {
    expect(parseFindIntent("Fix login (n_001)")).toEqual({
      kind: "text",
      needle: "Fix login (n_001)",
    });
    expect(parseFindIntent("auth")).toEqual({ kind: "text", needle: "auth" });
  });
});

describe("resolveNodeId", () => {
  const ids = new Set(["n_001", "n_0JC1YXY9BV"]);

  it("hits an exact id", () => {
    expect(resolveNodeId("n_001", ids)).toBe("n_001");
  });

  it("is case-insensitive", () => {
    expect(resolveNodeId("n_0jc1yxy9bv", ids)).toBe("n_0JC1YXY9BV");
  });

  it("applies a server→local alias before looking up", () => {
    const local = new Set(["local_1"]);
    expect(resolveNodeId("n_001", local, (id) => (id === "n_001" ? "local_1" : id))).toBe("local_1");
  });

  it("returns null when the token is not in the tree", () => {
    expect(resolveNodeId("n_404", ids)).toBeNull();
  });
});
