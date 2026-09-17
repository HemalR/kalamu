import { initKalamu, pathsFor } from "@kalamu/core/store";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetHubProject, listHubProjects } from "../src/hub-commands.js";
import { CliError } from "../src/context.js";
import { readRegistry, registerProject } from "../src/registry.js";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kalamu-hub-commands-"));
  process.env.KALAMU_REGISTRY = join(base, "projects.json");
  process.env.KALAMU_HOME = join(base, "kalamu-home");
});

afterEach(() => {
  delete process.env.KALAMU_REGISTRY;
  delete process.env.KALAMU_HOME;
  rmSync(base, { recursive: true, force: true });
});

function makeProject(name: string): string {
  const root = join(base, name);
  initKalamu(root);
  registerProject(root);
  return root;
}

describe("hub registry commands", () => {
  it("lists project slugs, paths and — for local-store projects — data dirs, in text and JSON output", () => {
    const alpha = makeProject("alpha");
    const beta = join(base, "beta");
    initKalamu(beta, { store: "repo" });
    registerProject(beta);
    const alphaDir = pathsFor(alpha).dir;

    const result = listHubProjects();

    expect(result.text).toBe(`alpha\t${alpha}\t${alphaDir}\nbeta\t${beta}`);
    expect(result.json).toEqual({
      projects: [
        { slug: "alpha", path: alpha, store: "local", dir: alphaDir },
        { slug: "beta", path: beta, store: "repo", dir: join(beta, ".kalamu") },
      ],
    });
  });

  it("forgets one project without touching its outline", () => {
    const alpha = makeProject("alpha");
    makeProject("beta");
    const outline = pathsFor(alpha).outline;
    const before = readFileSync(outline, "utf8");

    const result = forgetHubProject("alpha");

    expect(result.text).toContain("Project data was not changed");
    expect(result.json).toEqual({ slug: "alpha", path: alpha, forgotten: true });
    expect(readRegistry().projects.map((project) => project.slug)).toEqual(["beta"]);
    expect(readFileSync(outline, "utf8")).toBe(before);
  });

  it("explains how to find a slug and rejects an unknown one", () => {
    expect(() => forgetHubProject(undefined)).toThrowError(
      new CliError("hub forget requires a project slug (run `kalamu hub list` to find it)"),
    );
    expect(() => forgetHubProject("missing")).toThrowError('no registered project "missing"');
  });
});
