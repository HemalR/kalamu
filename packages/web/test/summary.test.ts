import { describe, expect, it } from "vitest";
import { summarize } from "../src/lib/summary";

describe("summarize", () => {
  it("cuts at the first sentence when nothing cuts earlier", () => {
    expect(summarize("Ship the workspace switcher this week. Billing items can interleave after it.")).toBe(
      "Ship the workspace switcher this week.",
    );
  });

  it("prefers a dash over a later sentence end", () => {
    expect(summarize("Multi-tenancy migration — path to production. Order matters; the plan doc is source of truth.")).toBe(
      "Multi-tenancy migration",
    );
  });

  it("cuts at a colon that introduces detail", () => {
    expect(summarize("setOrgInvoiceBilling conversion is unreachable: the guard refuses paymentMethod stripe")).toBe(
      "setOrgInvoiceBilling conversion is unreachable",
    );
  });

  it("cuts at a spaced dash", () => {
    expect(summarize("Rework the billing section — the invoice path needs its own form and a keyless variant")).toBe(
      "Rework the billing section",
    );
  });

  it("takes the earliest cut point, not the first kind checked", () => {
    // The colon comes before the sentence end; the colon must win.
    expect(summarize("Admin plan change is broken: downgrades never schedule. Fix the rank check.")).toBe(
      "Admin plan change is broken",
    );
  });

  it("returns null when the text is already its own summary", () => {
    expect(summarize("Fix the password reset redirect")).toBeNull();
  });

  it("never cuts a hyphenated word or an arrow", () => {
    expect(summarize("Verify the shadow-mode hardening path and the stripe->invoice conversion guard")).toBeNull();
  });

  it("never cuts inside a URL or a clock time", () => {
    expect(summarize("Check https://example.com/health returns 200 before the 10:30 cutover window")).toBeNull();
  });

  it("rejects a stub cut and takes the next boundary", () => {
    // "Done" alone says nothing, so the colon at index 4 is skipped.
    expect(summarize("Done: the poller now revokes sessions — verified against a live account")).toBe(
      "Done: the poller now revokes sessions",
    );
  });

  it("falls through to a later occurrence of the same cut kind", () => {
    // The first colon is a stub, and no dash or sentence end rescues the cut —
    // only the SECOND colon can, so every occurrence must be a candidate.
    expect(summarize("Fix: the reconnect loop drops the auth header on retry: repro in the gateway logs")).toBe(
      "Fix: the reconnect loop drops the auth header on retry",
    );
  });

  it("never cuts inside brackets", () => {
    const text = "DEFERRED to SSO setup time (Hemal: no SSO configured yet) so nothing can be deprovisioned. Revisit later.";
    const result = summarize(text);
    expect(result).toBe("DEFERRED to SSO setup time (Hemal: no SSO configured yet) so nothing can be deprovisioned.");
    const opens = (result?.match(/[([]/g) ?? []).length;
    const closes = (result?.match(/[)\]]/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("leaves no dangling separator on the cut", () => {
    expect(summarize("The multi-tenancy migration plan — see the doc for detail")).toBe("The multi-tenancy migration plan");
  });

  it("rejects a cut that would shorten by discarding the informative half", () => {
    // "Post-migration" and "Work on emails" are real examples: under the floor,
    // so the text stays whole rather than becoming a stub.
    expect(summarize("Post-migration: verify the poller revokes sessions for deleted users")).toBeNull();
  });

  it("handles blank and whitespace-only text", () => {
    expect(summarize("")).toBeNull();
    expect(summarize("   ")).toBeNull();
  });
});
