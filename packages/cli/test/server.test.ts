import { initKalamu, readUiState, type KalamuPaths } from "@kalamu/core/store";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type KalamuServer } from "../src/server.js";

let root: string;
let paths: KalamuPaths;
let server: KalamuServer;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kalamu-srv-"));
  paths = initKalamu(root).paths;
  server = createServer(paths, null);
});

afterEach(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
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

  it("404s unknown ids and 400s bad operations", async () => {
    expect((await server.app.request("/api/nodes/n_missing")).status).toBe(404);
    expect((await post("/api/nodes/n_missing/done", {})).status).toBe(404);
    const bullet = await createNode({ text: "thought" });
    // done on a bullet is allowed (visual strikethrough); handoff is not.
    const struck = await post(`/api/nodes/${bullet.id}/done`, {});
    expect(struck.status).toBe(200);
    expect(((await struck.json()) as { doneAt: string | null }).doneAt).not.toBeNull();
    expect((await post(`/api/nodes/${bullet.id}/handoff`, { target: "github", ref: "#1" })).status).toBe(400);
  });

  it("done, reopen, handoff, next, validate, search", async () => {
    const task = await createNode({ text: "ship it", kind: "task" });
    await post(`/api/nodes/${task.id}/done`, {});
    expect(((await (await server.app.request("/api/next")).json()) as { id: null }).id).toBeNull();

    await post(`/api/nodes/${task.id}/reopen`, {});
    expect(((await (await server.app.request("/api/next")).json()) as { id: string }).id).toBe(task.id);

    await post(`/api/nodes/${task.id}/handoff`, { target: "github", ref: "#1" });
    expect(((await (await server.app.request("/api/next")).json()) as { id: null }).id).toBeNull();

    const found = (await (await server.app.request("/api/search?q=ship")).json()) as { nodes: unknown[] };
    expect(found.nodes).toHaveLength(1);

    const validation = (await (await server.app.request("/api/validate")).json()) as { valid: boolean };
    expect(validation.valid).toBe(true);
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
