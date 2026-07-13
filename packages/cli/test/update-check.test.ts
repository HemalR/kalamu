import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cachedUpdate, isNewer, refreshUpdate } from "../src/update-check.js";

let base: string;
let file: string;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "kalamu-upd-"));
  file = join(base, "update-check.json");
  // Isolate from the real ~/.kalamu and any ambient opt-out.
  delete process.env.KALAMU_NO_UPDATE_CHECK;
  delete process.env.CI;
  process.env.KALAMU_HOME = base;
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  delete process.env.KALAMU_HOME;
  delete process.env.KALAMU_NO_UPDATE_CHECK;
  delete process.env.CI;
});

describe("isNewer", () => {
  it("compares x.y.z numerically, not lexically", () => {
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
    expect(isNewer("0.5.0", "0.5.0")).toBe(false);
    expect(isNewer("0.4.9", "0.5.0")).toBe(false);
  });

  it("treats pre-release or unparseable versions as no update", () => {
    expect(isNewer("1.0.0-beta.1", "0.9.0")).toBe(false);
    expect(isNewer("1.0.0", "0.9.0-rc")).toBe(false);
    expect(isNewer("latest", "0.9.0")).toBe(false);
  });
});

describe("refreshUpdate", () => {
  it("fetches when there is no cache and reports an available update", async () => {
    const info = await refreshUpdate("0.5.0", { file, now: 1000, fetchImpl: async () => "0.6.0" });
    expect(info).toEqual({ current: "0.5.0", latest: "0.6.0", updateAvailable: true });
    // The fetched version is cached with the attempt timestamp.
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ checkedAt: 1000, latest: "0.6.0" });
  });

  it("serves a fresh cache without hitting the network", async () => {
    writeFileSync(file, JSON.stringify({ checkedAt: 1000, latest: "0.6.0" }));
    let fetched = false;
    const info = await refreshUpdate("0.5.0", {
      file,
      now: 1000 + DAY - 1,
      fetchImpl: async () => {
        fetched = true;
        return "0.7.0";
      },
    });
    expect(fetched).toBe(false);
    expect(info.latest).toBe("0.6.0");
  });

  it("refetches once the cache is older than a day", async () => {
    writeFileSync(file, JSON.stringify({ checkedAt: 1000, latest: "0.6.0" }));
    const info = await refreshUpdate("0.5.0", { file, now: 1000 + DAY, fetchImpl: async () => "0.7.0" });
    expect(info.latest).toBe("0.7.0");
  });

  it("keeps the last known version and stamps the attempt when a stale refetch fails", async () => {
    writeFileSync(file, JSON.stringify({ checkedAt: 1000, latest: "0.6.0" }));
    const now = 1000 + DAY;
    const info = await refreshUpdate("0.5.0", { file, now, fetchImpl: async () => null });
    expect(info.latest).toBe("0.6.0");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ checkedAt: now, latest: "0.6.0" });
  });

  it("does nothing and never touches the network when opted out via env", async () => {
    process.env.KALAMU_NO_UPDATE_CHECK = "1";
    let fetched = false;
    const info = await refreshUpdate("0.5.0", {
      file,
      fetchImpl: async () => {
        fetched = true;
        return "0.6.0";
      },
    });
    expect(fetched).toBe(false);
    expect(info.updateAvailable).toBe(false);
  });

  it("opts out under CI", async () => {
    process.env.CI = "true";
    const info = await refreshUpdate("0.5.0", { file, fetchImpl: async () => "0.6.0" });
    expect(info.updateAvailable).toBe(false);
  });
});

describe("cachedUpdate", () => {
  it("reports from the cache with no network and no update when the cache is empty", () => {
    expect(cachedUpdate("0.5.0", file)).toEqual({ current: "0.5.0", latest: null, updateAvailable: false });
    writeFileSync(file, JSON.stringify({ checkedAt: 1000, latest: "0.6.0" }));
    expect(cachedUpdate("0.5.0", file)).toEqual({ current: "0.5.0", latest: "0.6.0", updateAvailable: true });
  });
});
