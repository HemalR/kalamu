/**
 * Relative time formatting: "3 minutes ago", "in 2 days", "yesterday".
 *
 * Dependency-free and browser-safe. Wording and pluralisation come from
 * `Intl.RelativeTimeFormat` rather than a hand-maintained word list, so every
 * locale the platform knows is free.
 *
 * Hours and below are counted as elapsed time, truncated — "1 hour ago" only
 * once a full hour has passed. Days and above are counted in *calendar* units
 * in the local timezone, so "yesterday" means the previous calendar day rather
 * than "somewhere between 24 and 48 hours back".
 */

export type DateInput = Date | string | number;

export type RelativeTimeUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year";

export interface RelativeTimeParts {
  /** Signed: negative is the past, positive the future. */
  value: number;
  unit: RelativeTimeUnit;
}

export interface RelativeTimeOptions {
  /** Reference point. Defaults to now; pass one to keep output deterministic. */
  now?: DateInput;
  locale?: string | string[];
  /** "long" → "3 minutes ago", "short" → "3 min. ago", "narrow" → "3m ago". */
  style?: Intl.RelativeTimeFormatStyle;
  /** "auto" (default) allows "yesterday"/"now"; "always" forces "1 day ago". */
  numeric?: Intl.RelativeTimeFormatNumeric;
}

/** Normalise any accepted input to a Date. Throws rather than silently drifting. */
export function toDate(input: DateInput): Date {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new TypeError(`Invalid date: ${String(input)}`);
  return date;
}

/** `+ 0` normalises -0, which `Object.is` (and so `toBe`) treats as distinct from 0. */
const trunc = (n: number): number => Math.trunc(n) + 0;

const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar months between two dates, trimming a month not yet fully elapsed. */
function calendarMonths(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (months > 0 && to.getDate() < from.getDate()) months--;
  if (months < 0 && to.getDate() > from.getDate()) months++;
  return months;
}

/**
 * Pick the largest unit that still reads naturally, and the signed count in it.
 * Exposed so callers can render their own wording (badges, `aria-label`s, tests)
 * without re-deriving the unit cascade.
 */
export function relativeTimeParts(date: DateInput, now: DateInput = new Date()): RelativeTimeParts {
  const target = toDate(date);
  const reference = toDate(now);

  const seconds = trunc((target.getTime() - reference.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return { value: seconds, unit: "second" };
  const minutes = trunc(seconds / 60);
  if (Math.abs(minutes) < 60) return { value: minutes, unit: "minute" };
  const hours = trunc(seconds / 3600);
  if (Math.abs(hours) < 24) return { value: hours, unit: "hour" };

  const days = Math.round((startOfDay(target) - startOfDay(reference)) / 86_400_000);
  if (Math.abs(days) < 7) return { value: days, unit: "day" };
  const months = calendarMonths(reference, target);
  if (months === 0) return { value: trunc(days / 7), unit: "week" };
  if (Math.abs(months) < 12) return { value: months, unit: "month" };
  return { value: trunc(months / 12), unit: "year" };
}

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function formatter({ locale, style = "long", numeric = "auto" }: RelativeTimeOptions): Intl.RelativeTimeFormat {
  const key = `${String(locale)}|${style}|${numeric}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, { style, numeric });
    formatters.set(key, cached);
  }
  return cached;
}

/** "3 minutes ago", "in 2 days", "yesterday". */
export function formatRelativeTime(date: DateInput, options: RelativeTimeOptions = {}): string {
  const { value, unit } = relativeTimeParts(date, options.now);
  return formatter(options).format(value, unit);
}

const COMPACT_SUFFIX: Record<RelativeTimeUnit, string> = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  week: "w",
  month: "mo",
  year: "y",
};

/**
 * Dense form for tight rows: "now", "3m", "5d", "in 2d". Not localised — it is
 * a glyph-sized affordance, and the full wording belongs in the tooltip.
 */
export function formatRelativeTimeCompact(date: DateInput, now?: DateInput): string {
  const { value, unit } = relativeTimeParts(date, now);
  if (unit === "second" && Math.abs(value) < 10) return "now";
  const label = `${Math.abs(value)}${COMPACT_SUFFIX[unit]}`;
  return value > 0 ? `in ${label}` : label;
}
