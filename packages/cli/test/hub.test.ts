import { tagColor } from "@kalamu/core";
import { initKalamu } from "@kalamu/core/store";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHubServer, watchBundle } from "../src/hub.js";
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
  // Keep lazily-created project instances from doing a real update check.
  process.env.KALAMU_HOME = base;
  process.env.KALAMU_NO_UPDATE_CHECK = "1";
  makeProject("alpha", "@acme/alpha");
  makeProject("beta");
  hub = createHubServer(null, { registryFile: file });
});

afterEach(() => {
  hub.close();
  rmSync(base, { recursive: true, force: true });
  delete process.env.KALAMU_HOME;
  delete process.env.KALAMU_NO_UPDATE_CHECK;
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
    // Registry order — registration order until reordered — not recency.
    expect(projects.map((p) => p.slug)).toEqual(["alpha", "beta"]);
    expect(projects.find((p) => p.slug === "alpha")?.name).toBe("@acme/alpha");
    expect(projects.every((p) => p.openTasks === 0)).toBe(true);
  });

  it("moves a project to a new sidebar position on PATCH {index}", async () => {
    const res = await hub.app.request("/api/projects/beta", {
      method: "PATCH",
      body: JSON.stringify({ index: 0 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const { projects } = (await (await hub.app.request("/api/projects")).json()) as { projects: { slug: string }[] };
    expect(projects.map((p) => p.slug)).toEqual(["beta", "alpha"]);
  });

  it("rejects a non-integer or negative index, and 404s an unknown slug", async () => {
    for (const index of [1.5, -1, "0"]) {
      const bad = await hub.app.request("/api/projects/alpha", {
        method: "PATCH",
        body: JSON.stringify({ index }),
        headers: { "Content-Type": "application/json" },
      });
      expect(bad.status).toBe(400);
    }
    const missing = await hub.app.request("/api/projects/nope", {
      method: "PATCH",
      body: JSON.stringify({ index: 0 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(missing.status).toBe(404);
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

  it("forgets a project on DELETE /api/projects/:slug", async () => {
    // Touch alpha first so its server instance exists and must be torn down.
    await hub.app.request("/p/alpha/api/nodes");
    const res = await hub.app.request("/api/projects/alpha", { method: "DELETE" });
    expect(res.status).toBe(204);

    const { projects } = (await (await hub.app.request("/api/projects")).json()) as { projects: { slug: string }[] };
    expect(projects.map((p) => p.slug)).toEqual(["beta"]);
    expect((await hub.app.request("/p/alpha/api/nodes")).status).toBe(404);
  });

  it("renames a project on PATCH /api/projects/:slug, visible in the list and the project header", async () => {
    // Touch alpha first so a live instance picks up the rename without restarting.
    await hub.app.request("/p/alpha/api/nodes");
    const res = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ name: "Alpha App" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await res.json()).toEqual({ name: "Alpha App", color: tagColor("alpha") });

    const { projects } = (await (await hub.app.request("/api/projects")).json()) as {
      projects: { slug: string; name: string }[];
    };
    expect(projects.find((p) => p.slug === "alpha")?.name).toBe("Alpha App");
    const project = (await (await hub.app.request("/p/alpha/api/project")).json()) as { name: string };
    expect(project.name).toBe("Alpha App");
  });

  it("clears the override on a blank rename, reverting to the derived name", async () => {
    await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ name: "Alpha App" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ name: "   " }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await res.json()).toEqual({ name: "@acme/alpha", color: tagColor("alpha") });
  });

  it("assigns every project a slug-derived theme colour", async () => {
    const { projects } = (await (await hub.app.request("/api/projects")).json()) as {
      projects: { slug: string; color: string }[];
    };
    expect(projects.find((p) => p.slug === "alpha")?.color).toBe(tagColor("alpha"));
    expect(projects.find((p) => p.slug === "beta")?.color).toBe(tagColor("beta"));
  });

  it("sets a theme colour on PATCH and reverts to the derived one on a blank colour", async () => {
    const set = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ color: "#0090FF" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await set.json()).toEqual({ name: "@acme/alpha", color: "#0090FF" });

    const { projects } = (await (await hub.app.request("/api/projects")).json()) as {
      projects: { slug: string; color: string }[];
    };
    expect(projects.find((p) => p.slug === "alpha")?.color).toBe("#0090FF");

    const cleared = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ color: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(await cleared.json()).toEqual({ name: "@acme/alpha", color: tagColor("alpha") });
  });

  it("rejects a malformed colour and a PATCH with neither field", async () => {
    const bad = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ color: "blue" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
    const empty = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    expect(empty.status).toBe(400);
  });

  it("rejects a PATCH without a string name, and 404s an unknown slug", async () => {
    const bad = await hub.app.request("/api/projects/alpha", {
      method: "PATCH",
      body: JSON.stringify({ name: 7 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(bad.status).toBe(400);
    const missing = await hub.app.request("/api/projects/nope", {
      method: "PATCH",
      body: JSON.stringify({ name: "x" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(missing.status).toBe(404);
  });

  it("404s a DELETE for an unknown slug", async () => {
    const res = await hub.app.request("/api/projects/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
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

describe("watchBundle", () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const setMtime = (file: string, msAgo: number): void => {
    const when = new Date(Date.now() - msAgo);
    utimesSync(file, when, when);
  };
  const untilFired = async (counter: () => number): Promise<void> => {
    for (let i = 0; i < 200 && counter() === 0; i++) await sleep(5);
  };

  it("fires once a replaced bundle lands, surviving the transient gap mid-reinstall", async () => {
    const bundle = join(base, "index.js");
    writeFileSync(bundle, "old");
    let fired = 0;
    const stop = watchBundle(bundle, () => fired++, 5, 0);
    rmSync(bundle);
    await sleep(30);
    expect(fired).toBe(0);
    writeFileSync(bundle, "new");
    setMtime(bundle, 60_000);
    await untilFired(() => fired);
    stop();
    await sleep(30);
    expect(fired).toBe(1);
  });

  it("holds off while the new mtime is still settling", async () => {
    const bundle = join(base, "index.js");
    writeFileSync(bundle, "old");
    let fired = 0;
    const stop = watchBundle(bundle, () => fired++, 5, 5 * 60_000);
    setMtime(bundle, 0);
    await sleep(30);
    expect(fired).toBe(0);
    setMtime(bundle, 6 * 60_000);
    await untilFired(() => fired);
    stop();
    expect(fired).toBe(1);
  });
});
