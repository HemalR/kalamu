import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as commands from "../src/commands.js";
import { writeConfig } from "../src/config.js";
import { CliError } from "../src/context.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "kalamu-link-"));
  process.env.KALAMU_HOME = join(cwd, "global");
  process.env.KALAMU_REGISTRY = join(cwd, "global", "projects.json");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@acme/My Project" }));
  commands.init(cwd, { agentDocs: false, gitignore: false });
});

afterEach(() => {
  delete process.env.KALAMU_HOME;
  delete process.env.KALAMU_REGISTRY;
  rmSync(cwd, { recursive: true, force: true });
});

describe("link", () => {
  it("prints a copy-ready Markdown reference using the default hub URL and registered slug", () => {
    const added = commands.add(cwd, { text: "Fix duplicate task creation\nPreserve the original request", kind: "task" });
    const id = (added.json as { id: string }).id;

    const result = commands.link(cwd, id);

    const url = `http://localhost:4400/p/my-project#z=${id}`;
    expect(result.text).toBe(`[Fix duplicate task creation](${url}) (\`${id}\`)`);
    expect(result.json).toEqual({ id, text: "Fix duplicate task creation", url, markdown: result.text });
  });

  it("uses the configured base URL and can print the raw URL", () => {
    writeConfig({ baseUrl: "https://kalamu.example.test/tools" });
    const added = commands.add(cwd, { text: "Ship it", kind: "task" });
    const id = (added.json as { id: string }).id;

    expect(commands.link(cwd, id, { format: "url" }).text).toBe(
      `https://kalamu.example.test/tools/p/my-project#z=${id}`,
    );
  });

  it("escapes Markdown labels and rejects unknown ids and formats", () => {
    const added = commands.add(cwd, { text: "Fix [duplicate] \\ handling", kind: "task" });
    const id = (added.json as { id: string }).id;

    expect(commands.link(cwd, id).text).toContain("[Fix \\[duplicate\\] \\\\ handling]");
    expect(() => commands.link(cwd, "n_missing")).toThrowError(new CliError("no node with id n_missing"));
    expect(() => commands.link(cwd, id, { format: "text" })).toThrow(/use markdown, url or json/);
  });
});
