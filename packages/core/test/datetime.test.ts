import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  formatRelativeTimeCompact,
  relativeTimeParts,
  toDate,
} from "../src/datetime.js";

/** Local time so calendar-day maths is exercised in the same zone the util uses. */
const at = (
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0,
): Date => new Date(year, month - 1, day, hour, minute, second);

const NOW = at(2026, 8, 10, 12, 0, 0);

describe("relativeTimeParts", () => {
  it("truncates elapsed time rather than rounding up", () => {
    expect(relativeTimeParts(at(2026, 8, 10, 11, 59, 1), NOW)).toEqual({ value: -59, unit: "second" });
    expect(relativeTimeParts(at(2026, 8, 10, 11, 0, 1), NOW)).toEqual({ value: -59, unit: "minute" });
    expect(relativeTimeParts(at(2026, 8, 10, 10, 30), NOW)).toEqual({ value: -1, unit: "hour" });
  });

  it("signs the future positive and the past negative", () => {
    expect(relativeTimeParts(at(2026, 8, 10, 14, 0), NOW)).toEqual({ value: 2, unit: "hour" });
    expect(relativeTimeParts(at(2026, 8, 10, 10, 0), NOW)).toEqual({ value: -2, unit: "hour" });
    expect(relativeTimeParts(NOW, NOW)).toEqual({ value: 0, unit: "second" });
  });

  it("counts days as calendar days, not 24-hour blocks", () => {
    // 37 hours back is two calendar days, and reads that way.
    expect(relativeTimeParts(at(2026, 8, 8, 23, 0), NOW)).toEqual({ value: -2, unit: "day" });
    expect(relativeTimeParts(at(2026, 8, 9, 1, 0), NOW)).toEqual({ value: -1, unit: "day" });
    // ...but under 24 hours stays in hours even across midnight.
    expect(relativeTimeParts(at(2026, 8, 9, 20, 0), NOW)).toEqual({ value: -16, unit: "hour" });
  });

  it("cascades through weeks, months and years", () => {
    expect(relativeTimeParts(at(2026, 8, 1), NOW)).toEqual({ value: -1, unit: "week" });
    expect(relativeTimeParts(at(2026, 6, 10), NOW)).toEqual({ value: -2, unit: "month" });
    expect(relativeTimeParts(at(2026, 9, 20), NOW)).toEqual({ value: 1, unit: "month" });
    expect(relativeTimeParts(at(2024, 2, 10), NOW)).toEqual({ value: -2, unit: "year" });
  });

  it("does not promote a month that has not fully elapsed", () => {
    // 10 Jul → 10 Aug is a month; 11 Jul → 10 Aug is not yet.
    expect(relativeTimeParts(at(2026, 7, 10), NOW)).toEqual({ value: -1, unit: "month" });
    expect(relativeTimeParts(at(2026, 7, 11), NOW).unit).toBe("week");
  });
});

describe("formatRelativeTime", () => {
  it("renders past and future in words", () => {
    expect(formatRelativeTime(at(2026, 8, 10, 11, 57), { now: NOW, locale: "en" })).toBe("3 minutes ago");
    expect(formatRelativeTime(at(2026, 8, 12), { now: NOW, locale: "en" })).toBe("in 2 days");
  });

  it("uses natural wording by default and numbers on request", () => {
    expect(formatRelativeTime(at(2026, 8, 9), { now: NOW, locale: "en" })).toBe("yesterday");
    expect(formatRelativeTime(at(2026, 8, 9), { now: NOW, locale: "en", numeric: "always" })).toBe(
      "1 day ago",
    );
  });

  it("accepts ISO strings, as stored on nodes", () => {
    const created = at(2026, 8, 10, 9, 0).toISOString();
    expect(formatRelativeTime(created, { now: NOW, locale: "en" })).toBe("3 hours ago");
  });
});

describe("formatRelativeTimeCompact", () => {
  it("packs into a badge-sized label", () => {
    expect(formatRelativeTimeCompact(NOW, NOW)).toBe("now");
    expect(formatRelativeTimeCompact(at(2026, 8, 10, 11, 45), NOW)).toBe("15m");
    expect(formatRelativeTimeCompact(at(2026, 8, 5), NOW)).toBe("5d");
    expect(formatRelativeTimeCompact(at(2026, 6, 10), NOW)).toBe("2mo");
    expect(formatRelativeTimeCompact(at(2026, 8, 12), NOW)).toBe("in 2d");
  });
});

describe("toDate", () => {
  it("throws on input that would otherwise format as nonsense", () => {
    expect(() => toDate("not a date")).toThrow(TypeError);
    expect(() => toDate(new Date(Number.NaN))).toThrow(TypeError);
    expect(toDate(NOW.getTime()).getTime()).toBe(NOW.getTime());
  });
});
