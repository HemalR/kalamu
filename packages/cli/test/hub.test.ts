import { initKalamu } from "@kalamu/core/store";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubServer } from "../src/hub.js";
import { registerProject } from "../src/registry.js";
import type { KalamuServer } from "../src/server.js";

let base: string;
let file: string;
let hub: KalamuServer;

function makeProject(dir: string, pkgName?: string): string {
  const root = join(base, dir);
  mkdirSync(root, { recursive: true });
  if (pkgName !== undefined) writeFileSync(join(root, "package.json"), JSON.stringify({ name: pkgName }));
  initKalamu(root);
  registerProject(root, file);
  return root;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kalamu-hub-"));
  file = join(base, "projects.json");
  makeProject("alpha", "@acme/alpha");
  makeProject("beta");
  hub = createHubServer(null, { registryFile: file });
});

afterEach(() => {
  hub.close();
  rmSync(base, { recursive: true, force: true });
});

describe("hub", () => {
  it("identifies itself on /api/hub", async () => {
    const res = await hub.app.request("/api/hub");
    expect(await res.json()).toEqual({ hub: true });
  });

  it("lists registered projects with open-task counts", async () => {
    const res = await hub.app.request("/api/projects");
    const { projects } = (await res.json()) as {
      projects: { slug: string; name: string; openTasks: number | null }[];
    };
    expect(projects.map((p) => p.slug).sort()).toEqual(["alpha", "beta"]);
    expect(projects.find((p) => p.slug === "alpha")?.name).toBe("@acme/alpha");
    expect(projects.every((p) => p.openTasks === 0)).toBe(true);
  });

  it("routes /p/:slug/api/* into that project's server, writes included", async () => {
    const created = await hub.app.request("/p/alpha/api/nodes", {
      method: "POST",
      body: JSON.stringify({ text: "Fix upload", kind: "task" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(created.status).toBe(201);

    const alpha = (await (await hub.app.request("/p/alpha/api/nodes")).json()) as { nodes: unknown[] };
    const beta = (await (await hub.app.request("/p/beta/api/nodes")).json()) as { nodes: unknown[] };
    expect(alpha.nodes).toHaveLength(1);
    expect(beta.nodes).toHaveLength(0);

    const counts = (await (await hub.app.request("/api/projects")).json()) as {
      projects: { slug: string; openTasks: number | null }[];
    };
    expect(counts.projects.find((p) => p.slug === "alpha")?.openTasks).toBe(1);
  });

  it("404s an unregistered slug", async () => {
    const res = await hub.app.request("/p/nope/api/nodes");
    expect(res.status).toBe(404);
  });

  it("redirects the root to the most recently seen project", async () => {
    const res = await hub.app.request("/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/^\/p\/(alpha|beta)$/);
  });
});
