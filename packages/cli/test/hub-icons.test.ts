import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createHubServer } from "../src/hub.js";

// A registry with one project — readRegistry only keeps entries whose outline
// file exists on disk, so create a real (empty) project.
const dir = mkdtempSync(join(tmpdir(), "kalamu-hub-icons-"));
const projPath = join(dir, "acme");
mkdirSync(join(projPath, ".kalamu"), { recursive: true });
writeFileSync(join(projPath, ".kalamu", "outline.jsonl"), "");
const registryFile = join(dir, "registry.json");
writeFileSync(
  registryFile,
  JSON.stringify({
    version: 1,
    projects: [
      {
        slug: "acme",
        name: "Acme",
        path: projPath,
        color: "#8e4ec6",
        registeredAt: "2026-07-14T00:00:00.000Z",
        lastSeenAt: "2026-07-14T00:00:00.000Z",
      },
    ],
  }),
);

const hub = createHubServer(null, { registryFile });
afterAll(() => hub.close());

describe("hub per-project install icons", () => {
  it("serves a manifest scoped to the project, in its colour", async () => {
    const res = await hub.app.fetch(new Request("http://h/p/acme/manifest.webmanifest"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const manifest = (await res.json()) as Record<string, unknown>;
    expect(manifest.name).toBe("Acme");
    expect(manifest.theme_color).toBe("#8e4ec6");
    expect(manifest.start_url).toBe("/p/acme/");
    expect(manifest.scope).toBe("/p/acme");
    expect(manifest.icons).toEqual([
      { src: "/p/acme/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/p/acme/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ]);
  });

  it("serves the icon SVG in the project's colour", async () => {
    const res = await hub.app.fetch(new Request("http://h/p/acme/icon.svg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain('fill="#8e4ec6"'); // full-bleed accent
    expect(svg).toContain("#fbf4e9"); // cream mark on the dark purple
  });

  it("404s for an unregistered project", async () => {
    const manifest = await hub.app.fetch(new Request("http://h/p/ghost/manifest.webmanifest"));
    const icon = await hub.app.fetch(new Request("http://h/p/ghost/icon.svg"));
    expect(manifest.status).toBe(404);
    expect(icon.status).toBe(404);
  });
});
