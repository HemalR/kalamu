import { describe, expect, it } from "vitest";
import { matches, SHORTCUTS } from "../src/lib/shortcuts";

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "Enter",
    code: "Enter",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent;
}

describe("cycle-kind shortcut", () => {
  it("uses Alt/Option+Enter and rejects the former modifier chord", () => {
    expect(SHORTCUTS.cycleKind.keys).toBe("Alt+Enter");
    expect(matches(keyEvent({ altKey: true }), SHORTCUTS.cycleKind)).toBe(true);
    expect(matches(keyEvent({ metaKey: true, shiftKey: true }), SHORTCUTS.cycleKind)).toBe(false);
    expect(matches(keyEvent({ ctrlKey: true, shiftKey: true }), SHORTCUTS.cycleKind)).toBe(false);
    expect(matches(keyEvent(), SHORTCUTS.cycleKind)).toBe(false);
  });
});
