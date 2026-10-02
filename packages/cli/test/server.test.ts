import { initKalamu, migrateStore, outlineVersion, pathsFor, readOutline, readUiState, type KalamuPaths } from "@kalamu/core/store";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE_VERSION_HEADER, createServer, VERSION_HEADER, type KalamuServer } from "../src/server.js";

let root: string;
let paths: KalamuPaths;
let server: KalamuServer;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kalamu-srv-"));
  // Isolate the update check: KALAMU_HOME keeps its cache out of the real
  // ~/.kalamu, and the opt-out keeps the server's startup refresh off the wire.
  home = mkdtempSync(join(tmpdir(), "kalamu-srv-home-"));
  process.env.KALAMU_HOME = home;
  process.env.KALAMU_NO_UPDATE_CHECK = "1";
  paths = initKalamu(root).paths;
  server = createServer(root, null);
});

afterEach(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  delete process.env.KALAMU_HOME;
  delete process.env.KALAMU_NO_UPDATE_CHECK;
});

async function post(path: string, body: unknown): Promise<Response> {
  return server.app.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function createNode(body: Record<string, unknown>): Promise<{ id: string }> {
  const res = await post("/api/nodes", body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe("nodes API", () => {
  it("creates, reads, patches, moves, deletes", async () => {
    const parent = await createNode({ text: "Auth", kind: "bullet" });
    const child = await createNode({ text: "Fix redirect", kind: "task", parentId: parent.id, priority: 1 });

    const listed = (await (await server.app.request("/api/nodes")).json()) as { nodes: { id: string }[] };
    expect(listed.nodes.map((n) => n.id)).toEqual([parent.id, child.id]);

    const patched = await server.app.request(`/api/nodes/${child.id}`, {
      method: "PATCH",
      body: JSON.stringify({ priority: "default", addTags: ["backend"] }),
      headers: { "Content-Type": "application/json" },
    });
    const node = (await patched.json()) as { priority?: number; text: string };
    expect(node.priority).toBeUndefined();
    expect(node.text).toBe("Fix redirect #backend");

    const moved = await post(`/api/nodes/${child.id}/move`, { parentId: null });
    expect(((await moved.json()) as { parentId: string | null }).parentId).toBeNull();

    const deleted = await server.app.request(`/api/nodes/${parent.id}`, { method: "DELETE" });
    expect(((await deleted.json()) as { deleted: number }).deleted).toBe(1);
  });

  const replace = async (nodes: unknown, version?: string): Promise<Response> =>
    server.app.request("/api/nodes", {
      method: "PUT",
      body: JSON.stringify({ nodes, version }),
      headers: { "Content-Type": "application/json" },
    });

  it("PUT /api/nodes replaces the outline (undo restore) and rejects invalid payloads", async () => {
    const a = await createNode({ text: "keep", kind: "task" });
    const loaded = await server.app.request("/api/nodes");
    const snapshot = (await loaded.json()) as { nodes: unknown[]; version: string };
    expect(loaded.headers.get(VERSION_HEADER)).toBe(snapshot.version);
    const deleted = await server.app.request(`/api/nodes/${a.id}`, { method: "DELETE" });
    // Every outline write reports the version it produced, and the one it was
    // applied on: the client adopts the first only when the second is its own.
    const version = deleted.headers.get(VERSION_HEADER) ?? "";
    expect(version).toBe(outlineVersion(paths.outline));
    expect(deleted.headers.get(BASE_VERSION_HEADER)).toBe(snapshot.version);

    const restored = await replace(snapshot.nodes, version);
    expect(restored.status).toBe(200);
    const body = (await restored.json()) as { nodes: { id: string }[]; version: string };
    expect(body.nodes.map((n) => n.id)).toEqual([a.id]);
    expect(body.version).toBe(restored.headers.get(VERSION_HEADER));
    expect(body.version).toBe(outlineVersion(paths.outline));

    expect((await replace([...snapshot.nodes, ...snapshot.nodes], body.version)).status).toBe(400); // duplicate ids
    expect((await replace(snapshot.nodes)).status).toBe(400); // no version
  });

  it("PUT /api/nodes refuses to clobber a write made since the client loaded", async () => {
    await createNode({ text: "mine", kind: "task" });
    const { nodes, version } = (await (await server.app.request("/api/nodes")).json()) as {
      nodes: unknown[];
      version: string;
    };
    await createNode({ text: "an agent's, meanwhile", kind: "task" });
    const stale = await replace(nodes, version);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "outline changed since it was loaded", code: "conflict" });
    expect(readOutline(paths.outline).nodes).toHaveLength(2);
  });

  it("whole-outline PUT keeps node fields this build doesn't know", async () => {
    await createNode({ text: "keep me", kind: "task" });
    const listed = (await (await server.app.request("/api/nodes")).json()) as {
      nodes: Record<string, unknown>[];
      version: string;
    };
    const withExtra = listed.nodes.map((n) => ({ ...n, futureField: "yes" }));
    const put = await replace(withExtra, listed.version);
    expect(put.status).toBe(200);
    const after = (await put.json()) as { nodes: Record<string, unknown>[] };
    expect(after.nodes[0]?.["futureField"]).toBe("yes");
  });

  it("404s unknown ids and 400s bad operations", async () => {
    expect((await server.app.request("/api/nodes/n_missing")).status).toBe(404);
    expect((await post("/api/nodes/n_missing/done", {})).status).toBe(404);
    const bullet = await createNode({ text: "thought" });
    // done on a bullet is allowed (visual strikethrough).
    const struck = await post(`/api/nodes/${bullet.id}/done`, {});
    expect(struck.status).toBe(200);
    expect(((await struck.json()) as { doneAt: string | null }).doneAt).not.toBeNull();
  });

  it("done, reopen, next, validate, search", async () => {
    const task = await createNode({ text: "ship it", kind: "task" });
    await post(`/api/nodes/${task.id}/done`, {});
    expect(((await (await server.app.request("/api/next")).json()) as { id: null }).id).toBeNull();

    await post(`/api/nodes/${task.id}/reopen`, {});
    expect(((await (await server.app.request("/api/next")).json()) as { id: string }).id).toBe(task.id);

    const found = (await (await server.app.request("/api/search?q=ship")).json()) as { nodes: unknown[] };
    expect(found.nodes).toHaveLength(1);

    const validation = (await (await server.app.request("/api/validate")).json()) as { valid: boolean };
    expect(validation.valid).toBe(true);
  });

  it("next reports the default priority for a task that stores none", async () => {
    const task = await createNode({ text: "no priority stored", kind: "task" });
    const next = (await (await server.app.request("/api/next")).json()) as { id: string; priority: number };
    expect(next).toMatchObject({ id: task.id, priority: 2 });
  });

  it("never records createdBy — everything through the UI is the developer typing", async () => {
    await createNode({ text: "typed by hand", kind: "task" });
    expect(readFileSync(paths.outline, "utf8")).not.toContain("createdBy");
  });

  it("surfaces a structurally broken outline instead of hiding the nodes it cannot place", async () => {
    writeFileSync(
      paths.outline,
      `${JSON.stringify({ id: "n_orphan", parentId: "n_gone", kind: "task", text: "x", createdAt: "2026-07-09T07:00:00.000Z", doneAt: null })}\n`,
    );
    const res = await server.app.request("/api/nodes");
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "invalid-outline", error: expect.stringMatching(/kalamu validate/) });
    expect((await post("/api/nodes", { text: "would drop the orphan" })).status).toBe(500);
  });

  it("follows the store when the project migrates under a running server", async () => {
    migrateStore(root, "repo");
    const node = await createNode({ text: "after the move" });
    expect(readOutline(pathsFor(root).outline).nodes.map((n) => n.id)).toEqual([node.id]);
    expect(pathsFor(root).store).toBe("repo");
  });
});

describe("request guard", () => {
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    server.app.request(`http://127.0.0.1:4242${path}`, init);

  it("answers loopback hosts and refuses any other Host (DNS rebinding)", async () => {
    expect((await request("/api/nodes", { headers: { Host: "localhost:4242" } })).status).toBe(200);
    const foreign = await request("/api/nodes", { headers: { Host: "evil.example:4242" } });
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toContain("kalamu config base-url");
  });

  it("answers the configured base-url's host through a proxy's X-Forwarded-Host", async () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ baseUrl: "https://box.example.dev:4400" }));
    const via = async (forwarded: string, host = "127.0.0.1:4400"): Promise<number> =>
      (await request("/api/nodes", { headers: { Host: host, "X-Forwarded-Host": forwarded } })).status;
    expect(await via("box.example.dev:4400")).toBe(200);
    expect(await via("BOX.example.dev:4400")).toBe(200);
    expect(await via("box.example.dev:4401")).toBe(403);
    // A local proxy may hand over the VM's own single-label name instead of loopback.
    expect(await via("box.example.dev:4400", "box:4400")).toBe(200);
    // A rebinding page can forge the forwarded header, never its own Host.
    expect(await via("box.example.dev:4400", "evil.example:4400")).toBe(403);
  });

  it("refuses cross-origin writes and non-JSON bodies on JSON routes", async () => {
    const send = async (headers: Record<string, string>): Promise<Response> =>
      request("/api/nodes", { method: "POST", body: JSON.stringify({ text: "csrf" }), headers });
    expect((await send({ "Content-Type": "text/plain", Origin: "https://evil.example" })).status).toBe(403);
    expect((await send({ "Content-Type": "application/json", Origin: "https://evil.example" })).status).toBe(403);
    expect((await send({ "Content-Type": "text/plain" })).status).toBe(415);
    expect((await send({ "Content-Type": "application/json", Origin: "http://localhost:4242" })).status).toBe(201);
    expect(readOutline(paths.outline).nodes).toHaveLength(1);
  });
});

describe("claim and blocker API", () => {
  it("start claims a task, refuses a second claim, and re-claims with force", async () => {
    const task = await createNode({ text: "claim me", kind: "task" });

    // The UI sends no body at all; the route reads that as no options.
    const claimed = await server.app.request(`/api/nodes/${task.id}/start`, { method: "POST" });
    expect(claimed.status).toBe(200);
    expect(((await claimed.json()) as { startedAt?: string }).startedAt).toBeDefined();

    expect((await post(`/api/nodes/${task.id}/start`, {})).status).toBe(400);
    expect((await post(`/api/nodes/${task.id}/start`, { force: true })).status).toBe(200);
  });

  it("end releases the claim; ending a task that was never started is a 400", async () => {
    const task = await createNode({ text: "release me", kind: "task" });
    expect((await post(`/api/nodes/${task.id}/end`, {})).status).toBe(400);

    await post(`/api/nodes/${task.id}/start`, {});
    const ended = await post(`/api/nodes/${task.id}/end`, {});
    expect(ended.status).toBe(200);
    expect(((await ended.json()) as { startedAt?: string }).startedAt).toBeUndefined();
  });

  it("block records the blocker; a cycle is a 409, not a 400", async () => {
    const a = await createNode({ text: "a", kind: "task" });
    const b = await createNode({ text: "b", kind: "task" });

    const blocked = await post(`/api/nodes/${a.id}/block`, { by: b.id });
    expect(blocked.status).toBe(200);
    expect(((await blocked.json()) as { blockedBy: string[] }).blockedBy).toEqual([b.id]);

    expect((await post(`/api/nodes/${b.id}/block`, { by: a.id })).status).toBe(409);
  });

  it("DELETE clears one blocker, or every blocker when no id is given", async () => {
    const blocked = await createNode({ text: "waits on two", kind: "task" });
    const a = await createNode({ text: "a", kind: "task" });
    const b = await createNode({ text: "b", kind: "task" });
    await post(`/api/nodes/${blocked.id}/block`, { by: a.id });
    await post(`/api/nodes/${blocked.id}/block`, { by: b.id });

    const one = await server.app.request(`/api/nodes/${blocked.id}/block/${a.id}`, { method: "DELETE" });
    expect(((await one.json()) as { blockedBy: string[] }).blockedBy).toEqual([b.id]);

    const all = await server.app.request(`/api/nodes/${blocked.id}/block`, { method: "DELETE" });
    expect(((await all.json()) as { blockedBy?: string[] }).blockedBy).toBeUndefined();
  });
});

describe("assets API", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  async function upload(body: Buffer, type: string): Promise<Response> {
    return server.app.request("/api/assets", {
      method: "POST",
      body: new Uint8Array(body),
      headers: { "Content-Type": type },
    });
  }

  it("stores a pasted image content-hashed and serves it back", async () => {
    const res = await upload(png, "image/png");
    expect(res.status).toBe(201);
    const { path, url } = (await res.json()) as { path: string; url: string };
    // The token keeps its `.kalamu/assets/` form whichever store holds the file;
    // the file itself sits beside the outline.
    expect(path).toMatch(/^\.kalamu\/assets\/img-[0-9a-f]{12}\.png$/);
    expect(existsSync(join(paths.dir, "assets", basename(path)))).toBe(true);

    const served = await server.app.request(url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    // A pasted SVG can carry script: assets render sandboxed, never sniffed.
    expect(served.headers.get("content-security-policy")).toBe("sandbox");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png);
  });

  it("dedupes identical bytes to the same path", async () => {
    const first = (await (await upload(png, "image/png")).json()) as { path: string };
    const second = (await (await upload(png, "image/png")).json()) as { path: string };
    expect(second.path).toBe(first.path);
  });

  it("rejects non-image types, empty bodies, and traversal reads", async () => {
    expect((await upload(png, "text/html")).status).toBe(415);
    expect((await upload(Buffer.alloc(0), "image/png")).status).toBe(400);
    expect((await server.app.request("/assets/..%2Fmeta.json")).status).toBe(404);
    expect((await server.app.request("/assets/nope.png")).status).toBe(404);
  });
});

describe("docs route", () => {
  it("serves a repo-relative .md file as plain text", async () => {
    mkdirSync(join(root, "plans"), { recursive: true });
    writeFileSync(join(root, "plans", "refresh.md"), "# Plan\n");
    const res = await server.app.request("/docs/plans/refresh.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toBe("# Plan\n");
  });

  it("serves a browser an HTML page whose headings carry slug ids for #anchors", async () => {
    writeFileSync(join(root, "plan.md"), "# Plan\n\n<b>raw</b>\n\n## Phase 2\n");
    const res = await server.app.request("/docs/plan.md", { headers: { accept: "text/html,*/*" } });
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<span id="phase-2">## Phase 2</span>');
    expect(html).toContain("&lt;b&gt;raw&lt;/b&gt;"); // source is shown, never rendered
  });

  it("rejects non-md files, missing files, and traversal reads", async () => {
    writeFileSync(join(root, "secret.txt"), "nope");
    writeFileSync(join(tmpdir(), "kalamu-docs-outside.md"), "outside");
    expect((await server.app.request("/docs/secret.txt")).status).toBe(404);
    expect((await server.app.request("/docs/missing.md")).status).toBe(404);
    // URL parsing collapses a literal ../, so the encoded form is the one that
    // reaches the handler — it must hit the repo-root guard, not the file.
    expect((await server.app.request("/docs/..%2Fkalamu-docs-outside.md")).status).toBe(404);
    // Nor through a symlink that resolves outside the repo.
    symlinkSync(join(tmpdir(), "kalamu-docs-outside.md"), join(root, "linked.md"));
    expect((await server.app.request("/docs/linked.md")).status).toBe(404);
  });
});

describe("files API", () => {
  it("lists git-tracked and untracked-but-not-ignored paths, never ignored ones", async () => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(root, "tracked.ts"), "export {};");
    writeFileSync(join(root, "untracked.ts"), "export {};");
    writeFileSync(join(root, "ignored.txt"), "nope");
    execFileSync("git", ["add", "tracked.ts"], { cwd: root });

    const { files, truncated } = (await (await server.app.request("/api/files")).json()) as {
      files: string[];
      truncated: boolean;
    };
    expect(files).toContain("tracked.ts");
    expect(files).toContain("untracked.ts");
    expect(files).not.toContain("ignored.txt");
    expect(truncated).toBe(false);
  });

  it("degrades to an empty list outside a git repo", async () => {
    const { files } = (await (await server.app.request("/api/files")).json()) as { files: string[] };
    expect(files).toEqual([]);
  });
});

describe("meta and ui-state API", () => {
  it("tag colour overrides round-trip and clear", async () => {
    const put = await server.app.request("/api/tags/backend", {
      method: "PUT",
      body: JSON.stringify({ color: "#123456" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(((await put.json()) as { tags?: Record<string, string> }).tags).toEqual({ backend: "#123456" });

    const cleared = await server.app.request("/api/tags/backend", {
      method: "PUT",
      body: JSON.stringify({ color: null }),
      headers: { "Content-Type": "application/json" },
    });
    expect(((await cleared.json()) as { tags?: Record<string, string> }).tags).toBeUndefined();

    const bad = await server.app.request("/api/tags/Bad%20Tag", {
      method: "PUT",
      body: JSON.stringify({ color: "#123456" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
  });

  it("project name falls back to the root directory name, prefers package.json", async () => {
    const fromDir = (await (await server.app.request("/api/project")).json()) as { name: string };
    expect(fromDir.name).toBe(basename(root));

    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "my-project" }));
    const fromPkg = (await (await server.app.request("/api/project")).json()) as { name: string };
    expect(fromPkg.name).toBe("my-project");
  });

  it("project reports platform and hub install state for the UI's discovery hints", async () => {
    const body = (await (await server.app.request("/api/project")).json()) as {
      platform: string;
      hubInstalled: boolean;
    };
    expect(body.platform).toBe(process.platform);
    expect(typeof body.hubInstalled).toBe("boolean");
  });

  it("project reports its store, and an off-default-branch main checkout only for a repo-store outline", async () => {
    const project = async (srv: KalamuServer) =>
      (await (await srv.app.request("/api/project")).json()) as { store: string; dataDir: string; branchDrift: unknown };
    const offMain = (dir: string): void => {
      mkdirSync(join(dir, ".git", "refs", "remotes", "origin"), { recursive: true });
      writeFileSync(join(dir, ".git", "refs", "remotes", "origin", "HEAD"), "ref: refs/remotes/origin/main\n");
      writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/feature\n");
    };

    // The default (local) store lives outside git: no checkout can swap it.
    expect(await project(server)).toMatchObject({ store: "local", dataDir: paths.dir, branchDrift: null });
    offMain(root);
    expect((await project(server)).branchDrift).toBeNull();

    const repoRoot = mkdtempSync(join(tmpdir(), "kalamu-srv-repo-"));
    const repo = createServer(initKalamu(repoRoot, { store: "repo" }).paths.root, null);
    try {
      expect(await project(repo)).toMatchObject({ store: "repo", branchDrift: null }); // not a git checkout yet
      offMain(repoRoot);
      expect((await project(repo)).branchDrift).toEqual({ head: "feature", expected: "main" });
      writeFileSync(join(repoRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
      expect((await project(repo)).branchDrift).toBeNull();
    } finally {
      repo.close();
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("project reports the update comparison from the cache for the UI chip", async () => {
    // No cache yet → no update known (the startup refresh is opted out here).
    const fresh = (await (await server.app.request("/api/project")).json()) as {
      version: string;
      latestVersion: string | null;
      updateAvailable: boolean;
    };
    expect(typeof fresh.version).toBe("string");
    expect(fresh.latestVersion).toBeNull();
    expect(fresh.updateAvailable).toBe(false);

    // Seed the cache with a newer release; /api/project reports it, no network.
    writeFileSync(join(home, "update-check.json"), JSON.stringify({ checkedAt: 1, latest: "999.0.0" }));
    const behind = (await (await server.app.request("/api/project")).json()) as {
      latestVersion: string | null;
      updateAvailable: boolean;
    };
    expect(behind.latestVersion).toBe("999.0.0");
    expect(behind.updateAvailable).toBe(true);
  });

  it("ui-state persists collapse sets", async () => {
    const put = await server.app.request("/api/ui-state", {
      method: "PUT",
      body: JSON.stringify({ collapsed: ["n_001"] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    expect(readUiState(paths.uiState)).toEqual({ collapsed: ["n_001"] });
    const got = (await (await server.app.request("/api/ui-state")).json()) as { collapsed: string[] };
    expect(got.collapsed).toEqual(["n_001"]);
  });
});
