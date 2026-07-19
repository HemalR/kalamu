import { describe, expect, it } from "vitest";
import { formatZoomHash, parseZoomHash } from "../src/lib/zoom";

describe("formatZoomHash", () => {
  it("formats an id", () => {
    expect(formatZoomHash("abc123")).toBe("#z=abc123");
  });

  it("formats null as the empty hash", () => {
    expect(formatZoomHash(null)).toBe("");
  });

  it("percent-encodes reserved characters", () => {
    expect(formatZoomHash("a b&c")).toBe("#z=a%20b%26c");
  });
});

describe("parseZoomHash", () => {
  it("round-trips through format", () => {
    expect(parseZoomHash(formatZoomHash("abc123"))).toBe("abc123");
    expect(parseZoomHash(formatZoomHash("a b&c"))).toBe("a b&c");
  });

  it("accepts the hash with or without the leading #", () => {
    expect(parseZoomHash("#z=abc")).toBe("abc");
    expect(parseZoomHash("z=abc")).toBe("abc");
  });

  it("returns null for the empty hash", () => {
    expect(parseZoomHash("")).toBe(null);
    expect(parseZoomHash("#")).toBe(null);
  });

  it("returns null without the z= prefix", () => {
    expect(parseZoomHash("#foo")).toBe(null);
    expect(parseZoomHash("#zoom=abc")).toBe(null);
  });

  it("returns null for an empty id", () => {
    expect(parseZoomHash("#z=")).toBe(null);
  });

  it("returns null for malformed percent-encoding", () => {
    expect(parseZoomHash("#z=%")).toBe(null);
  });
});
