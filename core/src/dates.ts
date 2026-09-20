/**
 * Time zone aware date helpers built only on Intl (no date library).
 *
 * All "day keys" are "YYYY-MM-DD" strings in a given IANA time zone. Plain
 * calendar arithmetic (addDays, dayDiff, weekdayOf) works on the key itself via
 * UTC math, which is exact because a calendar date has no time zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      // h23 avoids the "24:00" quirk some engines produce for midnight.
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "YYYY-MM-DD" of the instant `ms` as seen in `timeZone`. */
export function dayKey(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Offset of `timeZone` from UTC at instant `ms`, in milliseconds. */
function tzOffsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of local midnight at the start of the day containing `ms`. */
export function startOfDay(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const guess = Date.UTC(p.year, p.month - 1, p.day);
  // Two passes so the offset is evaluated near the true instant, which
  // matters on days where the offset changes (DST).
  const first = guess - tzOffsetMs(guess, timeZone);
  return guess - tzOffsetMs(first, timeZone);
}

/** Epoch ms of the next local midnight after `ms`. */
export function nextDayStart(ms: number, timeZone: string): number {
  // A local day is 23 to 25 hours. Start + 30h always lands inside the next day.
  return startOfDay(startOfDay(ms, timeZone) + 30 * 3_600_000, timeZone);
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  return new Date(keyToUtc(key) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive if b is later). */
export function dayDiff(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay();
}

/** The Monday on or before `key`. */
export function startOfWeekKey(key: string): string {
  return addDays(key, -((weekdayOf(key) + 6) % 7));
}

export const monthOf = (key: string) => key.slice(0, 7);
export const yearOf = (key: string) => key.slice(0, 4);
