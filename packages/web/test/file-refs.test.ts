import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryBackend } from "../src/lib/memory-backend";
import { fileRefs } from "../src/lib/file-refs.svelte";
import { setBackend, type ProjectInfo } from "../src/lib/api";

function configure(overrides: Partial<ProjectInfo> = {}): void {
  fileRefs.configure({
    name: "demo",
    platform: "darwin",
    hubInstalled: false,
    version: "0.0.0",
    latestVersion: null,
    updateAvailable: false,
    repoRoot: "/repo",
    editorTemplate: null,
    ...overrides,
  });
}

describe("editorUrl", () => {
  beforeEach(() => configure());

  it("is null until an editor is configured", () => {
    expect(fileRefs.editorUrl("src/a.ts")).toBeNull();
  });

  it("fills every {path} with the absolute path, encoding spaces", () => {
    configure({ editorTemplate: "vscode://file{path}" });
    expect(fileRefs.editorUrl("src/a.ts")).toBe("vscode://file/repo/src/a.ts");
    configure({ editorTemplate: "subl://open?url=file://{path}" });
    expect(fileRefs.editorUrl("my notes.md")).toBe("subl://open?url=file:///repo/my%20notes.md");
  });

  it("normalises a Windows root to forward slashes with one leading slash", () => {
    configure({ repoRoot: "C:\\repo", editorTemplate: "vscode://file{path}" });
    expect(fileRefs.editorUrl("src/a.ts")).toBe("vscode://file/C:/repo/src/a.ts");
  });
});

describe("match", () => {
  const files = [
    "packages/web/src/lib/caret.ts",
    "packages/cli/src/server.ts",
    "docs/caret-notes.md",
    "packages/core/src/tree.ts",
  ];

  beforeEach(async () => {
    setBackend({ ...createMemoryBackend([]), getFiles: () => Promise.resolve({ files, truncated: false }) });
    fileRefs.load();
    await Promise.resolve(); // let the fetch settle
  });

  it("ranks basename prefix above basename substring above path substring", () => {
    expect(fileRefs.match("caret")).toEqual([
      "packages/web/src/lib/caret.ts", // basename prefix
      "docs/caret-notes.md", // basename substring
    ]);
    expect(fileRefs.match("cli")).toEqual(["packages/cli/src/server.ts"]); // path only
  });

  it("is case-insensitive and returns the head of the list for an empty filter", () => {
    expect(fileRefs.match("CARET.TS")).toEqual(["packages/web/src/lib/caret.ts"]);
    expect(fileRefs.match("")).toEqual(files);
  });

  it("returns nothing when nothing matches", () => {
    expect(fileRefs.match("nonexistent")).toEqual([]);
  });
});
