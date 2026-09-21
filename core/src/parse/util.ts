/** Defensive helpers shared by the export parsers. Exports change shape, so nothing is trusted. */

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Oldest timestamp we accept as real (2015-01-01). Earlier values are placeholders like 0. */
const MIN_PLAUSIBLE_MS = Date.UTC(2015, 0, 1);
/** Timestamps this far past `now` are treated as bad data (clock skew is fine, next year is not). */
const FUTURE_TOLERANCE_MS = 24 * 3_600_000;

export function isPlausible(ms: number, now: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_PLAUSIBLE_MS && ms <= now + FUTURE_TOLERANCE_MS;
}

/**
 * Unix timestamp (usually float SECONDS, occasionally milliseconds, sometimes a
 * numeric string) to epoch ms. Returns null for missing or implausible values.
 */
export function unixToMs(v: unknown, now: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  // Seconds since epoch stay below 1e11 until the year 5138. Anything larger is already ms.
  const ms = n < 1e11 ? n * 1000 : n;
  return isPlausible(ms, now) ? Math.round(ms) : null;
}

/** ISO 8601 string (or a number) to epoch ms. Returns null for missing or implausible values. */
export function isoToMs(v: unknown, now: number): number | null {
  if (typeof v === "number") return unixToMs(v, now);
  if (typeof v !== "string" || v === "") return null;
  const ms = Date.parse(v);
  return isPlausible(ms, now) ? ms : null;
}

/** No single logged session may be longer than this. Real ones are hours; a runaway or forged one is not credible. */
export const MAX_SESSION_SPAN_MS = 7 * 24 * 3_600_000;

/**
 * True if a session's times are safe to chart: real dates (not 1970 or year
 * 9999), start before end, and a believable length. Day and month bucketing loop
 * over every day and month a session covers, so one impossible span used to
 * freeze the whole app, and because it was stored, kept freezing it on every
 * visit. Checked when a log is parsed AND when stored sessions are read back, so
 * data saved before this check existed cannot hurt either.
 */
export function isSaneSpan(startedAt: number, endedAt: number, now: number, maxMs = MAX_SESSION_SPAN_MS): boolean {
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(endedAt) &&
    isPlausible(startedAt, now) &&
    isPlausible(endedAt, now) &&
    endedAt >= startedAt &&
    endedAt - startedAt <= maxMs
  );
}

export function asString(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

export const ascending = (a: number, b: number) => a - b;
