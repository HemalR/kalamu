import { describe, expect, it } from "vitest";
import { serializeJsonl } from "../src/jsonl.js";
import { validateOutline } from "../src/validate.js";
import { bullet, task } from "./helpers.js";

describe("validateOutline", () => {
  it("passes a valid pre-order file", () => {
    const content = serializeJsonl([
      bullet("n_001"),
      task("n_002", { parentId: "n_001", priority: 1 }),
      bullet("n_003"),
    ]);
    expect(validateOutline(content)).toEqual({ valid: true, nodes: 3, errors: [], warnings: [] });
  });

  it("detects duplicate ids", () => {
    const content = serializeJsonl([bullet("n_001"), bullet("n_001")]);
    const result = validateOutline(content);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("duplicate id");
  });

  it("detects missing parents", () => {
    const content = serializeJsonl([task("n_002", { parentId: "n_ghost" })]);
    const result = validateOutline(content);
    expect(result.errors[0]).toContain("missing parent");
  });

  it("detects cycles", () => {
    const content = serializeJsonl([
      bullet("n_001", { parentId: "n_002" }),
      bullet("n_002", { parentId: "n_001" }),
    ]);
    const result = validateOutline(content);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("warns (not errors) when the file is not in pre-order", () => {
    const content = serializeJsonl([
      task("n_002", { parentId: "n_001" }), // child before parent
      bullet("n_001"),
    ]);
    const result = validateOutline(content);
    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toContain("pre-order");
  });

  it("reports invalid lines with line numbers", () => {
    const result = validateOutline("garbage\n");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/^line 1:/);
  });

  it("passes the empty file", () => {
    expect(validateOutline("")).toEqual({ valid: true, nodes: 0, errors: [], warnings: [] });
  });
});
