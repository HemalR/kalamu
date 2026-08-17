import { describe, expect, it } from "vitest";
import { isNodeIdToken, newId } from "../src/ids.js";

describe("isNodeIdToken", () => {
  it("accepts generated ids and short hand-written ones", () => {
    expect(isNodeIdToken(newId())).toBe(true);
    expect(isNodeIdToken("n_001")).toBe(true);
    expect(isNodeIdToken("n_0JC1YXY9BV")).toBe(true);
  });

  it("rejects empty, unprefixed, and punctuated strings", () => {
    expect(isNodeIdToken("")).toBe(false);
    expect(isNodeIdToken("n_")).toBe(false);
    expect(isNodeIdToken("001")).toBe(false);
    expect(isNodeIdToken("n_0JC1YXY9BV.")).toBe(false);
    expect(isNodeIdToken("Fix it (n_001)")).toBe(false);
  });
});
