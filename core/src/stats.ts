/**
 * Stats. Everything here is pure: `now` and `timeZone` are injected through
 * StatsContext, nothing reads the clock or the environment.
 */

import { addDays, dayDiff, dayKey, monthOf, nextDayStart, startOfWeekKey, weekdayOf, yearOf } from "./dates";
import type {
  Confidence,
  ConversationRecord,
  DayBucket,
  MonthBucket,
  Session,
  StatsContext,
  ToolKey,
  ToolStats,
} from "./types";

/**
 * Active seconds per local day. A session that crosses midnight is split so
 * each day only gets the part that fell inside it.
 */
export function dailySeconds(sessions: Session[], timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    let cursor = s.startedAt;
    while (cursor < s.endedAt) {
      const boundary = nextDayStart(cursor, timeZone);
      const chunkEnd = Math.min(s.endedAt, boundary);
      const key = dayKey(cursor, timeZone);
      out.set(key, (out.get(key) ?? 0) + (chunkEnd - cursor) / 1000);
      cursor = chunkEnd;
    }
  }
  return out;
}

/** Per-day active minutes, ascending by day. Days with no activity are omitted. */
export function dailyMinutes(sessions: Session[], timeZone: string): DayBucket[] {
  return [...dailySeconds(sessions, timeZone)]
    .map(([day, seconds]) => ({ day, minutes: seconds / 60 }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * Active hours per calendar month, ascending, with empty months between the
 * first and last active month filled with zero so a bar chart has no gaps.
 */
export function monthlyHours(sessions: Session[], timeZone: string): MonthBucket[] {
  const byMonth = new Map<string, number>();
  for (const [day, seconds] of dailySeconds(sessions, timeZone)) {
    const month = monthOf(day);
    byMonth.set(month, (byMonth.get(month) ?? 0) + seconds);
  }
  if (byMonth.size === 0) return [];
  const months = [...byMonth.keys()].sort();
  const out: MonthBucket[] = [];
  let [y, m] = months[0].split("-").map(Number);
  const [lastY, lastM] = months[months.length - 1].split("-").map(Number);
  while (y < lastY || (y === lastY && m <= lastM)) {
    const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
    out.push({ month: key, hours: (byMonth.get(key) ?? 0) / 3600 });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * A day is "active" if it has any usage. The current streak is still alive if
 * today has no usage yet but yesterday did, so it does not read as broken
 * during the morning.
 */
export function computeStreaks(days: DayBucket[], today: string): { current: number; longest: number } {
  const active = new Set<string>();
  for (const d of days) if (d.minutes > 0) active.add(d.day);
  if (active.size === 0) return { current: 0, longest: 0 };

  const sorted = [...active].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = dayDiff(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  let cursor = active.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (active.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest };
}

function argmax<K>(entries: Iterable<[K, number]>): K | null {
  let best: K | null = null;
  let bestValue = -Infinity;
  for (const [key, value] of entries) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

/**
 * Stats for one tool, or for all tools combined ("all").
 *
 * Combined stats sum the per-tool sessions. Two tools used at the same moment
 * therefore count twice in the hour total. That is deliberate (the total equals
 * the sum of the cards) and the UI says so.
 */
export function computeStats(
  sessions: Session[],
  records: ConversationRecord[],
  ctx: StatsContext,
  toolKey: ToolKey | "all" = "all",
): ToolStats {
  const s = toolKey === "all" ? sessions : sessions.filter((x) => x.toolKey === toolKey);
  const r = toolKey === "all" ? records : records.filter((x) => x.toolKey === toolKey);

  const bySecondsDay = dailySeconds(s, ctx.timeZone);
  const days: DayBucket[] = [...bySecondsDay].map(([day, sec]) => ({ day, minutes: sec / 60 }));

  const today = dayKey(ctx.now, ctx.timeZone);
  const weekStart = startOfWeekKey(today);
  const month = monthOf(today);
  const year = yearOf(today);
  const usage = { today: 0, week: 0, month: 0, year: 0 };
  const weekdayTotals = new Map<number, number>();
  const monthTotals = new Map<string, number>();
  for (const [day, sec] of bySecondsDay) {
    if (day === today) usage.today += sec;
    if (day >= weekStart && day <= today) usage.week += sec;
    if (monthOf(day) === month) usage.month += sec;
    if (yearOf(day) === year) usage.year += sec;
    weekdayTotals.set(weekdayOf(day), (weekdayTotals.get(weekdayOf(day)) ?? 0) + sec);
    monthTotals.set(monthOf(day), (monthTotals.get(monthOf(day)) ?? 0) + sec);
  }

  let firstUsed: number | null = null;
  let lastUsed: number | null = null;
  let totalSeconds = 0;
  let longest = 0;
  const confidences = new Set<Confidence>();
  for (const x of s) {
    if (firstUsed === null || x.startedAt < firstUsed) firstUsed = x.startedAt;
    if (lastUsed === null || x.endedAt > lastUsed) lastUsed = x.endedAt;
    totalSeconds += x.activeSeconds;
    if (x.activeSeconds > longest) longest = x.activeSeconds;
    confidences.add(x.confidence);
  }

  let user = 0;
  let assistant = 0;
  for (const x of r) {
    user += x.userMessages;
    assistant += x.assistantMessages;
  }

  const streaks = computeStreaks(days, today);
  const confidence: ToolStats["confidence"] =
    confidences.size > 1 ? "mixed" : confidences.size === 1 ? [...confidences][0] : "estimated";

  return {
    toolKey,
    firstUsed,
    lastUsed,
    daysSinceFirstUse: firstUsed === null ? null : Math.max(0, dayDiff(dayKey(firstUsed, ctx.timeZone), today)),
    totalSeconds,
    sessionCount: s.length,
    conversationCount: r.length,
    messages: { user, assistant, total: user + assistant },
    avgSessionSeconds: s.length === 0 ? 0 : totalSeconds / s.length,
    longestSessionSeconds: longest,
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    mostActiveWeekday: argmax(weekdayTotals),
    mostActiveMonth: argmax(monthTotals),
    usage,
    confidence,
  };
}
