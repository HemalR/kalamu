import { describe, expect, it } from "vitest";
import { planLaunch } from "../src/lib/launch";

const at = (path: string): URL => new URL(path, "http://localhost:4400");

describe("planLaunch", () => {
  it("applies the hash when the link targets the current project", () => {
    expect(planLaunch(at("/p/kalamu#z=n_009"), at("/p/kalamu#z=n_001"))).toEqual({ kind: "zoom", hash: "#z=n_009" });
    expect(planLaunch(at("/p/kalamu"), at("/p/kalamu#z=n_001"))).toEqual({ kind: "zoom", hash: "" });
  });

  it("navigates when the link targets another project", () => {
    expect(planLaunch(at("/p/other#z=n_009"), at("/p/kalamu"))).toEqual({
      kind: "navigate",
      href: "http://localhost:4400/p/other#z=n_009",
    });
  });

  it("does nothing for the URL already shown (the initial launch)", () => {
    expect(planLaunch(at("/p/kalamu#z=n_009"), at("/p/kalamu#z=n_009"))).toEqual({ kind: "noop" });
  });
});
