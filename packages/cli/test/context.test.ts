/** The off-default-branch warning (SPEC key decision 20) reaches stderr from any command. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as commands from "../src/commands.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "kalamu-context-"));
  process.env.KALAMU_REGISTRY = join(cwd, "test-registry.json");
  commands.init(cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("off-default-branch warning", () => {
  it("is written to stderr by an ordinary command, and stays quiet on the default branch", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mkdirSync(join(cwd, ".git", "refs", "remotes", "origin"), { recursive: true });
    writeFileSync(join(cwd, ".git", "refs", "remotes", "origin", "HEAD"), "ref: refs/remotes/origin/main\n");

    writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/main\n");
    commands.list(cwd, {});
    expect(stderr).not.toHaveBeenCalled();

    writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/feature\n");
    commands.list(cwd, {});
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toMatch(/is on feature, not main/);
  });
});
