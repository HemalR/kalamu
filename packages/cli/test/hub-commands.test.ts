import { initKalamu } from "@kalamu/core/store";
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
});

afterEach(() => {
  delete process.env.KALAMU_REGISTRY;
  rmSync(base, { recursive: true, force: true });
});

function makeProject(name: string): string {
  const root = join(base, name);
  initKalamu(root);
  registerProject(root);
  return root;
}

describe("hub registry commands", () => {
  it("lists project slugs and paths in text and JSON output", () => {
    const alpha = makeProject("alpha");
    const beta = makeProject("beta");

    const result = listHubProjects();

    expect(result.text).toBe(`alpha\t${alpha}\nbeta\t${beta}`);
    expect(result.json).toEqual({
      projects: [
        { slug: "alpha", path: alpha },
        { slug: "beta", path: beta },
      ],
    });
  });

  it("forgets one project without touching its outline", () => {
    const alpha = makeProject("alpha");
    makeProject("beta");
    const outline = join(alpha, ".kalamu", "outline.jsonl");
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
