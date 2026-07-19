import { describe, expect, it } from "vitest";
import { nextNumberPrefix } from "../src/lib/numbering";

describe("nextNumberPrefix", () => {
  it("continues a numbered prefix", () => {
    expect(nextNumberPrefix("1. foo")).toBe("2. ");
  });

  it("handles multi-digit numbers", () => {
    expect(nextNumberPrefix("12. x")).toBe("13. ");
  });

  it("ignores plain text", () => {
    expect(nextNumberPrefix("just some text")).toBe("");
  });

  it("ignores decimals — the dot must be followed by whitespace", () => {
    expect(nextNumberPrefix("3.14 pie")).toBe("");
  });

  it("ignores empty text", () => {
    expect(nextNumberPrefix("")).toBe("");
  });

  it("ignores a dot without a following space", () => {
    expect(nextNumberPrefix("1.foo")).toBe("");
  });

  it("counts a bare prefix with nothing after it", () => {
    expect(nextNumberPrefix("9. ")).toBe("10. ");
  });
});
