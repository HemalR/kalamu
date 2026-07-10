import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeJsonl } from "../src/jsonl.js";
import { addNode } from "../src/operations.js";
import {
  findRoot,
  initKalamu,
  pathsFor,
  readOutline,
  readUiState,
  StoreError,
  withOutline,
  writeUiState,
} from "../src/store.js";
import { bullet } from "./helpers.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kalamu-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("initKalamu", () => {
  it("creates outline and meta, never overwrites", () => {
    const first = initKalamu(root);
    expect(first.created).toBe(true);
    expect(readFileSync(first.paths.outline, "utf8")).toBe("");
    expect(JSON.parse(readFileSync(first.paths.meta, "utf8"))).toEqual({ version: 1 });

    writeFileSync(first.paths.outline, serializeJsonl([bullet("n_001")]));
    const second = initKalamu(root);
    expect(second.created).toBe(false);
    expect(readOutline(first.paths.outline).nodes).toHaveLength(1);
  });
});

describe("findRoot", () => {
  it("walks up to the nearest .kalamu and returns null when absent", () => {
    initKalamu(root);
    const nested = join(root, "packages", "deep");
    expect(findRoot(root)).toBe(root);
    expect(findRoot(nested)).toBe(root); // nested dir need not exist on disk to resolve upward
    expect(findRoot(tmpdir())).toBeNull();
  });
});

describe("withOutline", () => {
  it("applies an operation and persists pre-order", () => {
    const paths = initKalamu(root).paths;
    const id = withOutline(paths.outline, (nodes) => {
      const result = addNode(nodes, { text: "hello", now: "2026-07-09T09:00:00.000Z" });
      return { nodes: result.nodes, result: result.node.id };
    });
    expect(readOutline(paths.outline).nodes[0]?.id).toBe(id);
  });

  it("throws a helpful error when outline is missing", () => {
    expect(() => readOutline(pathsFor(root).outline)).toThrow(StoreError);
    expect(() => readOutline(pathsFor(root).outline)).toThrow(/kalamu init/);
  });

  it("refuses to operate on an invalid outline", () => {
    const paths = initKalamu(root).paths;
    writeFileSync(paths.outline, "garbage\n");
    expect(() => readOutline(paths.outline)).toThrow(/kalamu validate/);
  });
});

describe("ui state", () => {
  it("missing or corrupt means everything expanded", () => {
    const paths = pathsFor(root);
    expect(readUiState(paths.uiState)).toEqual({ collapsed: [] });
    initKalamu(root);
    writeFileSync(paths.uiState, "not json");
    expect(readUiState(paths.uiState)).toEqual({ collapsed: [] });
    writeUiState(paths.uiState, { collapsed: ["n_001"] });
    expect(readUiState(paths.uiState)).toEqual({ collapsed: ["n_001"] });
  });
});
