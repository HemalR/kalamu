import { afterEach, describe, expect, it, vi } from "vitest";
import { dropIndex, fetchProjects } from "../src/lib/hub";

describe("dropIndex", () => {
  it("lands above or below a row further down, net of the dragged row's removal", () => {
    expect(dropIndex(0, 2, false)).toBe(1);
    expect(dropIndex(0, 2, true)).toBe(2);
  });

  it("lands above or below a row further up as-is", () => {
    expect(dropIndex(3, 1, false)).toBe(1);
    expect(dropIndex(3, 1, true)).toBe(2);
  });

  it("dropping next to itself keeps the index (the caller's no-op)", () => {
    expect(dropIndex(2, 1, true)).toBe(2);
    expect(dropIndex(2, 3, false)).toBe(2);
  });
});

describe("fetchProjects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const project = {
    slug: "kalamu",
    name: "kalamu",
    path: "/repo",
    color: "#336699",
    openTasks: 3,
    lastSeenAt: "2026-10-01T00:00:00.000Z",
    missing: false,
  };

  it("keeps well-formed entries and drops the rest", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ projects: [project, { slug: "half" }] }));
    expect(await fetchProjects()).toEqual([project]);
  });

  it("is null when the hub can't answer", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await fetchProjects()).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });
    expect(await fetchProjects()).toBeNull();
  });
});
