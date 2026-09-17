import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeJsonl } from "../src/jsonl.js";
import { addNode } from "../src/operations.js";
import {
  dataHome,
  findRoot,
  initKalamu,
  migrateStore,
  offDefaultBranch,
  pathsFor,
  readMeta,
  readOutline,
  readUiState,
  StoreError,
  withOutline,
  writeMeta,
  writeUiState,
} from "../src/store.js";
import { bullet } from "./helpers.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kalamu-test-"));
  // Local-store data lands under the data home; keep it out of the real ~/.kalamu.
  process.env.KALAMU_HOME = join(root, "home");
});

afterEach(() => {
  delete process.env.KALAMU_HOME;
  rmSync(root, { recursive: true, force: true });
});

/** Lay out git's linked-worktree files by hand — no git binary needed. */
function makeWorktree(main: string, location: string, { commondir = true } = {}): string {
  const gitdir = join(main, ".git", "worktrees", "wt");
  mkdirSync(gitdir, { recursive: true });
  if (commondir) writeFileSync(join(gitdir, "commondir"), "../..\n");
  mkdirSync(location, { recursive: true });
  writeFileSync(join(location, ".git"), `gitdir: ${gitdir}\n`);
  return location;
}

const markerFile = (dir: string): string => join(dir, ".kalamu", "project.json");

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

  describe("in a linked git worktree", () => {
    it("resolves to the main checkout, ignoring the worktree's own committed .kalamu", () => {
      initKalamu(root);
      // Outside the main checkout, like ~/.t3/worktrees — a walk-up alone would never find it.
      const worktree = makeWorktree(root, mkdtempSync(join(tmpdir(), "kalamu-wt-")));
      mkdirSync(join(worktree, ".kalamu"));
      writeFileSync(join(worktree, ".kalamu", "outline.jsonl"), "");
      try {
        expect(findRoot(worktree)).toBe(root);
        expect(findRoot(join(worktree, "src", "deep"))).toBe(root);
      } finally {
        rmSync(worktree, { recursive: true, force: true });
      }
    });

    it("resolves a worktree with no .kalamu of its own (branch predates init)", () => {
      initKalamu(root);
      const worktree = makeWorktree(root, join(root, ".worktrees", "feature"));
      expect(findRoot(worktree)).toBe(root);
    });

    it("treats init inside a worktree as already initialised at the main checkout", () => {
      initKalamu(root);
      const worktree = makeWorktree(root, join(root, ".worktrees", "feature"));
      const result = initKalamu(worktree);
      expect(result.created).toBe(false);
      expect(result.paths.root).toBe(root);
    });

    it("stays its own project when the main checkout is not one, or when .git has no commondir", () => {
      const worktree = makeWorktree(root, join(root, ".worktrees", "feature"));
      initKalamu(worktree);
      expect(findRoot(worktree)).toBe(worktree);

      const submodule = makeWorktree(join(root, "super"), join(root, "super", "sub"), { commondir: false });
      initKalamu(join(root, "super"));
      initKalamu(submodule);
      expect(findRoot(submodule)).toBe(submodule);
    });
  });

  it("ignores a .kalamu directory without an outline (e.g. the hub's ~/.kalamu config dir)", () => {
    mkdirSync(join(root, ".kalamu"), { recursive: true });
    writeFileSync(join(root, ".kalamu", "projects.json"), "{}");
    expect(findRoot(root)).toBeNull();
    expect(findRoot(join(root, "somewhere", "deep"))).toBeNull();
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
    const paths = initKalamu(root).paths;
    expect(readUiState(paths.uiState)).toEqual({ collapsed: [] });
    writeFileSync(paths.uiState, "not json");
    expect(readUiState(paths.uiState)).toEqual({ collapsed: [] });
    writeUiState(paths.uiState, { collapsed: ["n_001"] });
    expect(readUiState(paths.uiState)).toEqual({ collapsed: ["n_001"] });
  });

  it("reads a legacy compact key as overview", () => {
    const paths = initKalamu(root).paths;
    writeFileSync(paths.uiState, JSON.stringify({ collapsed: [], compact: true }) + "\n");
    expect(readUiState(paths.uiState)).toEqual({ collapsed: [], overview: true });
  });
});

describe("stores (SPEC key decision 21)", () => {
  it("local by default: a committed marker in .kalamu/, the data under the data home", () => {
    const { paths } = initKalamu(root);
    expect(paths.store).toBe("local");
    expect(paths.root).toBe(root);
    const marker = JSON.parse(readFileSync(markerFile(root), "utf8")) as { id: string };
    expect(marker.id).toMatch(/^kalamu-test-[a-z0-9]+-[0-9a-f]{6}$/);
    expect(dataHome()).toBe(join(root, "home", "projects"));
    expect(paths.dir).toBe(join(dataHome(), marker.id));
    expect(readdirSync(join(root, ".kalamu"))).toEqual(["project.json"]);
    expect(readFileSync(paths.outline, "utf8")).toBe("");
    expect(pathsFor(root)).toEqual(paths);
  });

  it("repo on request: everything under .kalamu/, no marker; an existing project keeps its store", () => {
    const { paths } = initKalamu(root, { store: "repo" });
    expect(paths.store).toBe("repo");
    expect(paths.dir).toBe(join(root, ".kalamu"));
    expect(existsSync(markerFile(root))).toBe(false);
    expect(initKalamu(root, { store: "local" })).toEqual({ created: false, paths });
  });

  it("a marker whose data is missing on this machine (a fresh clone) gets an empty outline from init", () => {
    const { paths } = initKalamu(root);
    writeFileSync(paths.outline, serializeJsonl([bullet("n_001")]));
    rmSync(paths.dir, { recursive: true });
    expect(findRoot(root)).toBe(root); // still a project: the marker says so
    expect(() => readOutline(paths.outline)).toThrow(StoreError);
    expect(initKalamu(root)).toEqual({ created: true, paths });
    expect(readOutline(paths.outline).nodes).toEqual([]);
  });

  it("a linked worktree of a local-store checkout resolves to the same data", () => {
    const { paths } = initKalamu(root);
    const worktree = makeWorktree(root, join(root, ".worktrees", "feature"));
    const resolved = findRoot(worktree);
    expect(resolved).toBe(root);
    expect(pathsFor(resolved ?? "")).toEqual(paths);
  });

  it("rejects a corrupt marker loudly rather than guessing a data dir", () => {
    mkdirSync(join(root, ".kalamu"));
    writeFileSync(markerFile(root), '{"id": "../escape"}');
    expect(findRoot(root)).toBe(root);
    expect(() => pathsFor(root)).toThrow(/invalid .*project\.json/);
  });

  it("dataHome: KALAMU_DATA_DIR beats config.json dataDir beats ~/.kalamu/projects", () => {
    expect(dataHome()).toBe(join(root, "home", "projects"));
    mkdirSync(join(root, "home"), { recursive: true });
    writeFileSync(join(root, "home", "config.json"), JSON.stringify({ dataDir: join(root, "synced") }));
    expect(dataHome()).toBe(join(root, "synced"));
    process.env.KALAMU_DATA_DIR = join(root, "env");
    try {
      expect(dataHome()).toBe(join(root, "env"));
    } finally {
      delete process.env.KALAMU_DATA_DIR;
    }
  });
});

describe("migrateStore", () => {
  it("repo → local → repo carries outline, meta, view state and assets, and leaves no second copy", () => {
    const repo = initKalamu(root, { store: "repo" }).paths;
    writeFileSync(repo.outline, serializeJsonl([bullet("n_001"), bullet("n_002")]));
    writeMeta(repo.meta, { version: 1, tags: { web: "#123456" } });
    writeUiState(repo.uiState, { collapsed: ["n_001"] });
    mkdirSync(join(repo.dir, "assets"));
    writeFileSync(join(repo.dir, "assets", "img-abc.png"), "png");
    writeFileSync(join(repo.dir, "server.lock"), "{}");

    const out = migrateStore(root, "local");
    expect(out).toMatchObject({
      from: "repo",
      to: "local",
      nodes: 2,
      moved: ["outline.jsonl", "meta.json", "ui-state.json", "assets"],
    });
    const local = out.paths;
    expect(local).toEqual(pathsFor(root));
    expect(local.store).toBe("local");
    expect(readOutline(local.outline).nodes.map((n) => n.id)).toEqual(["n_001", "n_002"]);
    expect(readMeta(local.meta).tags).toEqual({ web: "#123456" });
    expect(readUiState(local.uiState)).toEqual({ collapsed: ["n_001"] });
    expect(readFileSync(join(local.dir, "assets", "img-abc.png"), "utf8")).toBe("png");
    expect(readdirSync(join(root, ".kalamu"))).toEqual(["project.json"]);
    expect(() => migrateStore(root, "local")).toThrow(/already/);

    const back = migrateStore(root, "repo");
    expect(back).toMatchObject({ from: "local", to: "repo", nodes: 2 });
    expect(back.paths).toEqual(repo);
    expect(readOutline(repo.outline).nodes).toHaveLength(2);
    expect(readFileSync(join(repo.dir, "assets", "img-abc.png"), "utf8")).toBe("png");
    expect(existsSync(local.dir)).toBe(false);
    expect(existsSync(markerFile(root))).toBe(false);
  });

  it("to repo overwrites a stale committed copy an old branch left behind", () => {
    const { paths } = initKalamu(root);
    writeFileSync(paths.outline, serializeJsonl([bullet("n_live")]));
    writeFileSync(join(root, ".kalamu", "outline.jsonl"), serializeJsonl([bullet("n_stale")]));
    expect(pathsFor(root)).toEqual(paths); // the marker wins while it exists
    migrateStore(root, "repo");
    expect(readOutline(join(root, ".kalamu", "outline.jsonl")).nodes.map((n) => n.id)).toEqual(["n_live"]);
  });
});

describe("offDefaultBranch", () => {
  /** Lay out a main checkout's .git by hand — no git binary needed. */
  function gitDir(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
      const file = join(root, ".git", name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
  }

  it("is null outside git, on the default branch, or when no default is known", () => {
    expect(offDefaultBranch(root)).toBeNull();
    gitDir({ HEAD: "ref: refs/heads/main\n", "refs/remotes/origin/HEAD": "ref: refs/remotes/origin/main\n" });
    expect(offDefaultBranch(root)).toBeNull();
    gitDir({ HEAD: "ref: refs/heads/feature\n" });
    rmSync(join(root, ".git", "refs", "remotes"), { recursive: true });
    expect(offDefaultBranch(root)).toBeNull(); // no origin/HEAD, no main/master
  });

  it("reports the branch and the default from origin/HEAD", () => {
    gitDir({ HEAD: "ref: refs/heads/feature/x\n", "refs/remotes/origin/HEAD": "ref: refs/remotes/origin/trunk\n" });
    expect(offDefaultBranch(root)).toEqual({ head: "feature/x", expected: "trunk" });
  });

  it("falls back to a local main or master, loose or packed", () => {
    gitDir({ HEAD: "ref: refs/heads/feature\n", "refs/heads/main": "0".repeat(40) + "\n" });
    expect(offDefaultBranch(root)).toEqual({ head: "feature", expected: "main" });
    rmSync(join(root, ".git", "refs", "heads", "main"));
    gitDir({ "packed-refs": `# pack-refs with: peeled fully-peeled sorted \n${"1".repeat(40)} refs/heads/master\n` });
    expect(offDefaultBranch(root)).toEqual({ head: "feature", expected: "master" });
  });

  it("names a detached HEAD by its short hash", () => {
    gitDir({ HEAD: "abcdef0123456789abcdef0123456789abcdef01\n", "refs/remotes/origin/HEAD": "ref: refs/remotes/origin/main\n" });
    expect(offDefaultBranch(root)).toEqual({ head: "detached HEAD abcdef0", expected: "main" });
  });
});
