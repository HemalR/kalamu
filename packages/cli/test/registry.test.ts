import { initKalamu } from "@kalamu/core/store";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRegistry, registerProject, renameProject, slugify, unregisterProject } from "../src/registry.js";

let base: string;
let file: string;

function makeProject(dir: string, pkgName?: string): string {
  const root = join(base, dir);
  mkdirSync(root, { recursive: true });
  if (pkgName !== undefined) writeFileSync(join(root, "package.json"), JSON.stringify({ name: pkgName }));
  initKalamu(root);
  return root;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kalamu-reg-"));
  file = join(base, "registry", "projects.json");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("slugify", () => {
  it("strips scope, lowercases, collapses non-url characters", () => {
    expect(slugify("@acme/My App!")).toBe("my-app");
    expect(slugify("kalamu")).toBe("kalamu");
    expect(slugify("--- ---")).toBe("project");
  });
});

describe("registerProject", () => {
  it("derives the slug from package.json name, else the directory name", () => {
    registerProject(makeProject("alpha", "@acme/alpha-app"), file);
    registerProject(makeProject("beta-dir"), file);
    expect(readRegistry(file).projects.map((p) => p.slug)).toEqual(["alpha-app", "beta-dir"]);
  });

  it("dedupes colliding slugs with numeric suffixes", () => {
    mkdirSync(join(base, "one"));
    mkdirSync(join(base, "two"));
    registerProject(makeProject("one/api"), file);
    registerProject(makeProject("two/api"), file);
    expect(readRegistry(file).projects.map((p) => p.slug)).toEqual(["api", "api-2"]);
  });

  it("keeps an existing slug when the project is renamed (bookmarks survive)", () => {
    const root = makeProject("gamma", "gamma");
    registerProject(root, file);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "renamed" }));
    registerProject(root, file);
    const projects = readRegistry(file).projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]?.slug).toBe("gamma");
  });

  it("touches lastSeenAt on re-registration", () => {
    const root = makeProject("delta");
    registerProject(root, file);
    const before = readRegistry(file).projects[0];
    registerProject(root, file);
    const after = readRegistry(file).projects[0];
    if (!before || !after) throw new Error("expected one registry entry");
    expect(after.registeredAt).toBe(before.registeredAt);
    expect(after.lastSeenAt >= before.lastSeenAt).toBe(true);
  });

  it("never throws on a corrupt registry file and recovers", () => {
    mkdirSync(join(base, "registry"), { recursive: true });
    writeFileSync(file, "{not json");
    const root = makeProject("epsilon");
    expect(() => registerProject(root, file)).not.toThrow();
    expect(readRegistry(file).projects.map((p) => p.path)).toEqual([root]);
  });
});

describe("unregisterProject", () => {
  it("forgets the entry but leaves the project's .kalamu data alone", () => {
    const root = makeProject("zeta");
    registerProject(root, file);
    expect(unregisterProject("zeta", file)).toBe(true);
    expect(readRegistry(file).projects).toEqual([]);
    // Re-registration works because nothing on disk was touched.
    registerProject(root, file);
    expect(readRegistry(file).projects.map((p) => p.slug)).toEqual(["zeta"]);
  });

  it("returns false for an unknown slug", () => {
    registerProject(makeProject("eta"), file);
    expect(unregisterProject("nope", file)).toBe(false);
    expect(readRegistry(file).projects).toHaveLength(1);
  });
});

describe("renameProject", () => {
  it("sets a trimmed display-name override that survives re-registration", () => {
    const root = makeProject("theta", "theta");
    registerProject(root, file);
    expect(renameProject("theta", "  Theta App  ", file)).toBe("Theta App");
    registerProject(root, file);
    expect(readRegistry(file).projects[0]?.name).toBe("Theta App");
  });

  it("clears the override on a blank name and returns null for an unknown slug", () => {
    registerProject(makeProject("iota"), file);
    renameProject("iota", "Iota", file);
    expect(renameProject("iota", "   ", file)).toBe("iota");
    expect(readRegistry(file).projects[0]?.name).toBeUndefined();
    expect(renameProject("nope", "x", file)).toBeNull();
  });
});

describe("readRegistry", () => {
  it("prunes entries whose project lost its .kalamu directory", () => {
    const keep = makeProject("keep");
    const gone = makeProject("gone");
    registerProject(keep, file);
    registerProject(gone, file);
    rmSync(gone, { recursive: true, force: true });
    expect(readRegistry(file).projects.map((p) => p.path)).toEqual([keep]);
  });

  it("prunes entries whose .kalamu remains but has no outline (config dirs are not projects)", () => {
    const keep = makeProject("keep");
    const husk = makeProject("husk");
    registerProject(keep, file);
    registerProject(husk, file);
    rmSync(join(husk, ".kalamu", "outline.jsonl"));
    expect(readRegistry(file).projects.map((p) => p.path)).toEqual([keep]);
  });

  it("returns an empty registry for a missing file", () => {
    expect(readRegistry(join(base, "nope.json"))).toEqual({ version: 1, projects: [] });
  });
});
