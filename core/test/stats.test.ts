import { describe, expect, it } from "vitest";
import { addDays, dayKey, nextDayStart, startOfDay, startOfWeekKey } from "../src/dates";
import { sessionize } from "../src/sessionize";
import { computeStats, computeStreaks, dailyMinutes, monthlyHours } from "../src/stats";
import { HOUR, MIN, at, rec } from "./helpers";

const UTC = { timeZone: "UTC" };

describe("dates", () => {
  it("buckets by the local day of the given time zone", () => {
    const t = at("2026-03-01T17:00:00Z"); // 01:00 on Mar 2 in Manila (UTC+8)
    expect(dayKey(t, "UTC")).toBe("2026-03-01");
    expect(dayKey(t, "Asia/Manila")).toBe("2026-03-02");
  });

  it("finds local midnight, including on a 23 hour DST day", () => {
    const start = startOfDay(at("2026-03-08T12:00:00Z"), "America/New_York");
    expect(start).toBe(at("2026-03-08T05:00:00Z"));
    expect(nextDayStart(start, "America/New_York") - start).toBe(23 * HOUR);
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeekKey("2026-03-08")).toBe("2026-03-02"); // Sunday -> previous Monday
    expect(startOfWeekKey("2026-03-02")).toBe("2026-03-02"); // Monday -> itself
    expect(addDays("2026-03-01", 1)).toBe("2026-03-02");
  });
});

describe("dailyMinutes", () => {
  it("splits a session that crosses midnight across both days", () => {
    const sessions = sessionize([rec("chatgpt", [at("2026-03-01T23:50:00Z"), at("2026-03-02T00:10:00Z")])], "chatgpt", {
      inactivityGapMs: 60 * MIN,
    });
    expect(dailyMinutes(sessions, "UTC")).toEqual([
      { day: "2026-03-01", minutes: 10 },
      { day: "2026-03-02", minutes: 10 },
    ]);
  });

  it("uses the supplied time zone to decide the day", () => {
    const sessions = sessionize([rec("chatgpt", [at("2026-03-01T17:00:00Z"), at("2026-03-01T17:10:00Z")])], "chatgpt");
    expect(dailyMinutes(sessions, "Asia/Manila")).toEqual([{ day: "2026-03-02", minutes: 10 }]);
  });
});

describe("monthlyHours", () => {
  it("fills empty months between the first and last active month", () => {
    const sessions = sessionize(
      [
        rec("claude", [at("2026-01-10T10:00:00Z"), at("2026-01-10T11:00:00Z")], { externalRef: "a" }),
        rec("claude", [at("2026-03-10T10:00:00Z")], { externalRef: "b" }),
      ],
      "claude",
      { inactivityGapMs: 2 * HOUR },
    );
    const months = monthlyHours(sessions, "UTC");
    expect(months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(months[0].hours).toBeCloseTo(1);
    expect(months[1].hours).toBe(0);
  });
});

describe("computeStreaks", () => {
  const days = (...ds: string[]) => ds.map((day) => ({ day, minutes: 5 }));

  it("counts consecutive days ending today", () => {
    const r = computeStreaks(days("2026-03-01", "2026-03-02", "2026-03-03"), "2026-03-03");
    expect(r).toEqual({ current: 3, longest: 3 });
  });

  it("keeps the current streak alive when only today is empty", () => {
    expect(computeStreaks(days("2026-03-01", "2026-03-02"), "2026-03-03").current).toBe(2);
  });

  it("breaks the current streak after a missed day but remembers the longest", () => {
    const r = computeStreaks(days("2026-03-01", "2026-03-02", "2026-03-03", "2026-03-06"), "2026-03-06");
    expect(r).toEqual({ current: 1, longest: 3 });
  });

  it("is zero with no activity", () => {
    expect(computeStreaks([], "2026-03-03")).toEqual({ current: 0, longest: 0 });
  });
});

describe("computeStats", () => {
  // Now is Wednesday 2026-03-11, 12:00 UTC.
  const now = at("2026-03-11T12:00:00Z");
  const ctx = { now, ...UTC };

  const records = [
    // Mon Mar 2: 30 min
    rec("chatgpt", [at("2026-03-02T09:00:00Z"), at("2026-03-02T09:15:00Z"), at("2026-03-02T09:30:00Z")], { externalRef: "a" }),
    // Tue Mar 10: 10 min (this week)
    rec("chatgpt", [at("2026-03-10T09:00:00Z"), at("2026-03-10T09:10:00Z")], { externalRef: "b" }),
    // Wed Mar 11 (today): single message, floored to 1 min
    rec("chatgpt", [at("2026-03-11T08:00:00Z")], { externalRef: "c" }),
    // Prior year, Claude: 20 min
    rec("claude", [at("2025-12-24T09:00:00Z"), at("2025-12-24T09:10:00Z"), at("2025-12-24T09:20:00Z")], { externalRef: "d" }),
  ];
  const sessions = [...sessionize(records, "chatgpt"), ...sessionize(records, "claude")];

  it("computes per-tool stats", () => {
    const s = computeStats(sessions, records, ctx, "chatgpt");
    expect(s.sessionCount).toBe(3);
    expect(s.conversationCount).toBe(3);
    expect(s.totalSeconds).toBe((30 + 10 + 1) * 60);
    expect(s.longestSessionSeconds).toBe(30 * 60);
    expect(s.avgSessionSeconds).toBeCloseTo((41 * 60) / 3);
    expect(s.firstUsed).toBe(at("2026-03-02T09:00:00Z"));
    expect(s.daysSinceFirstUse).toBe(9);
    expect(s.messages.total).toBe(6); // 3 + 2 + 1
    expect(s.confidence).toBe("estimated");
  });

  it("windows usage by today, calendar week (Monday), month and year", () => {
    const s = computeStats(sessions, records, ctx, "chatgpt");
    expect(s.usage.today).toBe(60);
    expect(s.usage.week).toBe((10 + 1) * 60); // Mon Mar 9 onward; Mar 2 is last week
    expect(s.usage.month).toBe(41 * 60);
    expect(s.usage.year).toBe(41 * 60);
  });

  it("combines tools without hiding the earlier year", () => {
    const s = computeStats(sessions, records, ctx, "all");
    expect(s.sessionCount).toBe(4);
    expect(s.totalSeconds).toBe((41 + 20) * 60);
    expect(s.firstUsed).toBe(at("2025-12-24T09:00:00Z"));
    expect(s.usage.year).toBe(41 * 60); // the December session is last year
    expect(s.mostActiveMonth).toBe("2026-03");
  });

  it("finds the most active weekday", () => {
    const s = computeStats(sessions, records, ctx, "chatgpt");
    expect(s.mostActiveWeekday).toBe(1); // Monday, 30 minutes
  });

  it("computes streaks from active days", () => {
    const s = computeStats(sessions, records, ctx, "chatgpt");
    expect(s.currentStreak).toBe(2); // Mar 10 and Mar 11
    expect(s.longestStreak).toBe(2);
  });

  it("returns clean zeros for a tool with no data", () => {
    const s = computeStats(sessions, records, ctx, "claude_code");
    expect(s.firstUsed).toBeNull();
    expect(s.lastUsed).toBeNull();
    expect(s.totalSeconds).toBe(0);
    expect(s.mostActiveWeekday).toBeNull();
    expect(s.avgSessionSeconds).toBe(0);
  });

  it("flags mixed confidence instead of silently blending it", () => {
    const measured = { ...sessions[0], confidence: "measured" as const, id: "m", externalRef: "m" };
    const s = computeStats([...sessions, measured], records, ctx, "all");
    expect(s.confidence).toBe("mixed");
  });
});

describe("makeIntensity", () => {
  it("returns 0 for no activity and keeps the top level reachable with very few active days", async () => {
    const { makeIntensity } = await import("../src/heat");
    const level = makeIntensity([10, 10, 12]);
    expect(level(0)).toBe(0);
    expect(level(10)).toBe(1);
    expect(level(12)).toBe(4);
  });

  it("spreads many active days across all four levels", async () => {
    const { makeIntensity } = await import("../src/heat");
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    const level = makeIntensity(values);
    const seen = new Set(values.map(level));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("copes with no data at all", async () => {
    const { makeIntensity } = await import("../src/heat");
    expect(makeIntensity([])(5)).toBe(4);
    expect(makeIntensity([])(0)).toBe(0);
  });
});

describe("linesChanged", () => {
  it("sums linesChanged across a tool's sessions, treating missing values as zero", () => {
    const now = at("2026-03-11T12:00:00Z");
    const sessions = [
      { id: "1", toolKey: "claude_code" as const, startedAt: at("2026-03-10T09:00:00Z"), endedAt: at("2026-03-10T10:00:00Z"), activeSeconds: 3600, messageCount: 4, linesChanged: 30, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "1" },
      { id: "2", toolKey: "claude_code" as const, startedAt: at("2026-03-10T11:00:00Z"), endedAt: at("2026-03-10T11:30:00Z"), activeSeconds: 1800, messageCount: 2, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "2" }, // no linesChanged
    ];
    const s = computeStats(sessions, [], { now, timeZone: "UTC" }, "claude_code");
    expect(s.linesChanged).toBe(30);
  });

  it("is zero for a tool with no sessions", () => {
    const now = at("2026-03-11T12:00:00Z");
    const s = computeStats([], [], { now, timeZone: "UTC" }, "chatgpt");
    expect(s.linesChanged).toBe(0);
  });
});
