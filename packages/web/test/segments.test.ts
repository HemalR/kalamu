import { describe, expect, it } from "vitest";
import { assetUrl, segmentText, tagSpans } from "../src/lib/segments";

describe("segmentText", () => {
  it("renders a mid-sentence token as a chip in place", () => {
    expect(segmentText("Build a new #feature to do xyz")).toEqual([
      { kind: "text", text: "Build a new ", start: 0 },
      { kind: "tag", label: "feature", name: "feature", start: 12, length: 8 },
      { kind: "text", text: " to do xyz", start: 20 },
    ]);
  });

  it("handles a token at the start and at the end", () => {
    expect(segmentText("#perf matters")).toEqual([
      { kind: "tag", label: "perf", name: "perf", start: 0, length: 5 },
      { kind: "text", text: " matters", start: 5 },
    ]);
    expect(segmentText("tune the parser #perf")).toEqual([
      { kind: "text", text: "tune the parser ", start: 0 },
      { kind: "tag", label: "perf", name: "perf", start: 16, length: 5 },
    ]);
  });

  it("handles multiple tokens", () => {
    const segs = segmentText("#a b #c");
    expect(segs.filter((s) => s.kind === "tag").map((s) => (s.kind === "tag" ? s.name : ""))).toEqual(["a", "c"]);
  });

  it("preserves label case but lowercases the derived name", () => {
    const seg = segmentText("ship #API today")[1];
    expect(seg).toEqual({ kind: "tag", label: "API", name: "api", start: 5, length: 4 });
  });

  it("never matches inside longer words or against punctuation", () => {
    expect(segmentText("see issue#42 now")).toEqual([{ kind: "text", text: "see issue#42 now", start: 0 }]);
    expect(segmentText("wat #x, no")).toEqual([{ kind: "text", text: "wat #x, no", start: 0 }]);
  });

  it("returns a single empty text segment for empty text", () => {
    expect(segmentText("")).toEqual([{ kind: "text", text: "", start: 0 }]);
  });

  it("renders a pasted-image token as an image segment in place", () => {
    expect(segmentText("before ![](.kalamu/assets/img-abc123.png) after")).toEqual([
      { kind: "text", text: "before ", start: 0 },
      { kind: "image", alt: "", path: ".kalamu/assets/img-abc123.png", start: 7, length: 34 },
      { kind: "text", text: " after", start: 41 },
    ]);
  });

  it("captures alt text and mixes with #tags", () => {
    const segs = segmentText("see ![shot](.kalamu/assets/img-a.png) for #backend");
    expect(segs).toEqual([
      { kind: "text", text: "see ", start: 0 },
      { kind: "image", alt: "shot", path: ".kalamu/assets/img-a.png", start: 4, length: 33 },
      { kind: "text", text: " for ", start: 37 },
      { kind: "tag", label: "backend", name: "backend", start: 42, length: 8 },
    ]);
  });

  it("does not split a #word inside an image token's alt text", () => {
    const segs = segmentText("x ![ #y](.kalamu/assets/img-a.png)");
    expect(segs.filter((s) => s.kind === "tag")).toEqual([]);
    expect(segs.filter((s) => s.kind === "image")).toHaveLength(1);
  });

  it("only matches images under .kalamu/assets/", () => {
    expect(segmentText("![](https://evil.example/x.png)")).toEqual([
      { kind: "text", text: "![](https://evil.example/x.png)", start: 0 },
    ]);
  });
});

describe("assetUrl", () => {
  it("rewrites the stored path to the served URL", () => {
    expect(assetUrl(".kalamu/assets/img-abc.png")).toBe("/assets/img-abc.png");
  });
});

describe("tagSpans (live highlight ranges)", () => {
  it("returns #-inclusive spans for multiple tags", () => {
    expect(tagSpans("fix #api and #Perf now")).toEqual([
      { start: 4, end: 8, name: "api" },
      { start: 13, end: 18, name: "perf" },
    ]);
  });

  it("handles tags at the start and end of the text", () => {
    expect(tagSpans("#a mid #b")).toEqual([
      { start: 0, end: 2, name: "a" },
      { start: 7, end: 9, name: "b" },
    ]);
  });

  it("returns nothing without tags or for near-tokens", () => {
    expect(tagSpans("plain text")).toEqual([]);
    expect(tagSpans("issue#42 p1 @me")).toEqual([]);
    expect(tagSpans("")).toEqual([]);
  });
});
