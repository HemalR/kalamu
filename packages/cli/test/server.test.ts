import { initKalamu, readUiState, type KalamuPaths } from "@kalamu/core/store";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type KalamuServer } from "../src/server.js";

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
  server = createServer(paths, null);
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

  it("PUT /api/nodes replaces the outline (undo restore) and rejects invalid payloads", async () => {
    const a = await createNode({ text: "keep", kind: "task" });
    const snapshot = ((await (await server.app.request("/api/nodes")).json()) as { nodes: unknown[] }).nodes;
    await server.app.request(`/api/nodes/${a.id}`, { method: "DELETE" });

    const restored = await server.app.request("/api/nodes", {
      method: "PUT",
      body: JSON.stringify({ nodes: snapshot }),
      headers: { "Content-Type": "application/json" },
    });
    expect(restored.status).toBe(200);
    expect(((await restored.json()) as { nodes: { id: string }[] }).nodes.map((n) => n.id)).toEqual([a.id]);

    const bad = await server.app.request("/api/nodes", {
      method: "PUT",
      body: JSON.stringify({ nodes: [...snapshot, ...snapshot] }), // duplicate ids
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
  });

  it("whole-outline PUT keeps node fields this build doesn't know", async () => {
    await createNode({ text: "keep me", kind: "task" });
    const listed = (await (await server.app.request("/api/nodes")).json()) as { nodes: Record<string, unknown>[] };
    const withExtra = listed.nodes.map((n) => ({ ...n, futureField: "yes" }));
    const put = await server.app.request("/api/nodes", {
      method: "PUT",
      body: JSON.stringify({ nodes: withExtra }),
      headers: { "Content-Type": "application/json" },
    });
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
    expect(path).toMatch(/^\.kalamu\/assets\/img-[0-9a-f]{12}\.png$/);
    expect(existsSync(join(root, path))).toBe(true);

    const served = await server.app.request(url);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
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
