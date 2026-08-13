import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HUB_BASE_URL } from "../src/hub-url.js";
import { hubBaseUrl, normalizeBaseUrl, writeConfig } from "../src/config.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kalamu-config-"));
  process.env.KALAMU_HOME = home;
});

afterEach(() => {
  delete process.env.KALAMU_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("hub base URL", () => {
  it("defaults old and unconfigured installs to the default hub address", () => {
    expect(hubBaseUrl()).toBe(DEFAULT_HUB_BASE_URL);
  });

  it("normalizes a configured address and falls back from an invalid stored value", () => {
    writeConfig({ baseUrl: "https://kalamu.example.test/tools/" });
    expect(hubBaseUrl()).toBe("https://kalamu.example.test/tools");

    writeConfig({ baseUrl: "not a URL" });
    expect(hubBaseUrl()).toBe(DEFAULT_HUB_BASE_URL);
  });

  it("rejects unsafe or structurally conflicting addresses", () => {
    expect(normalizeBaseUrl("ftp://example.test")).toBeNull();
    expect(normalizeBaseUrl("https://user:secret@example.test")).toBeNull();
    expect(normalizeBaseUrl("https://example.test?tenant=one")).toBeNull();
    expect(normalizeBaseUrl("https://example.test/#fragment")).toBeNull();
  });
});
