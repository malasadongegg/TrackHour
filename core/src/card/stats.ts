import { fmtDate, fmtDuration, fmtHours, fmtInt, fmtMonth, WEEKDAYS } from "../format";
import type { ToolStats } from "../types";
import type { CardStatKey } from "./types";

export type StatGroup = "Totals" | "Sessions" | "Habits" | "Recent";

export interface CardStatDef {
  label: string;
  group: StatGroup;
  /** Stand-alone value, for grid cells. */
  value(s: ToolStats, timeZone: string): string;
  /** Reads as a phrase, for the compact layout's one line summary. */
  phrase(s: ToolStats, timeZone: string): string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`;

/**
 * One definition per selectable stat. The web checklist and the SVG renderer
 * both read from here, so labels can never drift apart.
 */
export const CARD_STATS: Record<CardStatKey, CardStatDef> = {
  hoursOnRecord: {
    label: "Hours on record",
    group: "Totals",
    value: (s) => `${fmtHours(s.totalSeconds)} hrs`,
    phrase: (s) => `${fmtHours(s.totalSeconds)} hrs on record`,
  },
  lastUsed: {
    label: "Last used",
    group: "Totals",
    value: (s, tz) => fmtDate(s.lastUsed, tz),
    phrase: (s, tz) => `last used ${fmtDate(s.lastUsed, tz)}`,
  },
  firstUsed: {
    label: "First used",
    group: "Totals",
    value: (s, tz) => fmtDate(s.firstUsed, tz),
    phrase: (s, tz) => `first used ${fmtDate(s.firstUsed, tz)}`,
  },
  daysSinceFirstUse: {
    label: "Days since first use",
    group: "Totals",
    value: (s) => (s.daysSinceFirstUse === null ? "None" : fmtInt(s.daysSinceFirstUse)),
    phrase: (s) => (s.daysSinceFirstUse === null ? "not used yet" : `${plural(s.daysSinceFirstUse, "day")} since first use`),
  },
  sessions: {
    label: "Sessions",
    group: "Sessions",
    value: (s) => fmtInt(s.sessionCount),
    phrase: (s) => plural(s.sessionCount, "session"),
  },
  conversations: {
    label: "Conversations",
    group: "Sessions",
    value: (s) => fmtInt(s.conversationCount),
    phrase: (s) => plural(s.conversationCount, "conversation"),
  },
  messages: {
    label: "Messages",
    group: "Sessions",
    value: (s) => fmtInt(s.messages.total),
    phrase: (s) => plural(s.messages.total, "message"),
  },
  avgSession: {
    label: "Average session",
    group: "Sessions",
    value: (s) => (s.sessionCount ? fmtDuration(s.avgSessionSeconds) : "None"),
    phrase: (s) => `avg session ${s.sessionCount ? fmtDuration(s.avgSessionSeconds) : "none"}`,
  },
  longestSession: {
    label: "Longest session",
    group: "Sessions",
    value: (s) => (s.sessionCount ? fmtDuration(s.longestSessionSeconds) : "None"),
    phrase: (s) => `longest session ${s.sessionCount ? fmtDuration(s.longestSessionSeconds) : "none"}`,
  },
  currentStreak: {
    label: "Current streak",
    group: "Habits",
    value: (s) => plural(s.currentStreak, "day"),
    phrase: (s) => `${plural(s.currentStreak, "day")} streak`,
  },
  longestStreak: {
    label: "Longest streak",
    group: "Habits",
    value: (s) => plural(s.longestStreak, "day"),
    phrase: (s) => `best streak ${plural(s.longestStreak, "day")}`,
  },
  mostActiveWeekday: {
    label: "Most active weekday",
    group: "Habits",
    value: (s) => (s.mostActiveWeekday === null ? "None" : WEEKDAYS[s.mostActiveWeekday]),
    phrase: (s) => `busiest on ${s.mostActiveWeekday === null ? "none" : WEEKDAYS[s.mostActiveWeekday] + "s"}`,
  },
  mostActiveMonth: {
    label: "Most active month",
    group: "Habits",
    value: (s) => (s.mostActiveMonth === null ? "None" : fmtMonth(s.mostActiveMonth)),
    phrase: (s) => `busiest month ${s.mostActiveMonth === null ? "none" : fmtMonth(s.mostActiveMonth)}`,
  },
  usageToday: {
    label: "Today",
    group: "Recent",
    value: (s) => fmtDuration(s.usage.today),
    phrase: (s) => `today ${fmtDuration(s.usage.today)}`,
  },
  usageWeek: {
    label: "This week",
    group: "Recent",
    value: (s) => fmtDuration(s.usage.week),
    phrase: (s) => `this week ${fmtDuration(s.usage.week)}`,
  },
  usageMonth: {
    label: "This month",
    group: "Recent",
    value: (s) => fmtDuration(s.usage.month),
    phrase: (s) => `this month ${fmtDuration(s.usage.month)}`,
  },
  usageYear: {
    label: "This year",
    group: "Recent",
    value: (s) => fmtDuration(s.usage.year),
    phrase: (s) => `this year ${fmtDuration(s.usage.year)}`,
  },
};
