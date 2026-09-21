import { describe, expect, it } from "vitest";
import {
  DEFAULT_CARD_CONFIG,
  MAX_SESSION_SPAN_MS,
  buildCardData,
  dailySeconds,
  isSaneSpan,
  monthlyHours,
  parseClaudeCodeLog,
  parseExtensionLog,
  renderCard,
  type Session,
} from "../src";
import { at } from "./helpers";

const NOW = at("2026-09-21T12:00:00Z");
const HOUR = 3_600_000;

const hookLog = (...sessions: unknown[]) => ({ source: "trackhour-claude-code-hook", version: 1, sessions });
const entry = (startedAt: number, endedAt: number, extra: Record<string, unknown> = {}) => ({
  toolKey: "claude_code",
  startedAt,
  endedAt,
  activeSeconds: 1,
  messageCount: 1,
  externalRef: `s${startedAt}`,
  ...extra,
});

describe("isSaneSpan", () => {
  it("accepts a normal recent session", () => {
    expect(isSaneSpan(NOW - 2 * HOUR, NOW - HOUR, NOW)).toBe(true);
  });
  it("rejects placeholder dates, far-future dates, inverted and endless spans", () => {
    expect(isSaneSpan(0, 60_000, NOW)).toBe(false); // 1970
    expect(isSaneSpan(at("2014-12-31T00:00:00Z"), at("2014-12-31T01:00:00Z"), NOW)).toBe(false);
    expect(isSaneSpan(at("9999-01-01T00:00:00Z"), at("9999-01-01T01:00:00Z"), NOW)).toBe(false);
    expect(isSaneSpan(NOW - HOUR, NOW - 2 * HOUR, NOW)).toBe(false); // ends before it starts
    expect(isSaneSpan(NOW - MAX_SESSION_SPAN_MS - 1, NOW, NOW)).toBe(false); // longer than a week
    expect(isSaneSpan(NaN, NOW, NOW)).toBe(false);
    expect(isSaneSpan(NOW - HOUR, Infinity, NOW)).toBe(false);
  });
  it("allows a tiny clock skew into the future but not next month", () => {
    expect(isSaneSpan(NOW - HOUR, NOW + HOUR, NOW)).toBe(true);
    expect(isSaneSpan(NOW + 30 * 24 * HOUR, NOW + 30 * 24 * HOUR + HOUR, NOW)).toBe(false);
  });
});

describe("Claude Code log validation (the file that used to freeze the app)", () => {
  it("skips a session spanning 1970 to the end of time instead of accepting it", () => {
    const { sessions, skipped } = parseClaudeCodeLog(hookLog(entry(0, 8.64e15)), NOW);
    expect(sessions).toEqual([]);
    expect(skipped).toBe(1);
  });

  it("day bucketing over what remains is instant, where the old input never finished", () => {
    const { sessions } = parseClaudeCodeLog(hookLog(entry(0, 8.64e15), entry(NOW - 3 * HOUR, NOW - 2 * HOUR)), NOW);
    const t0 = Date.now();
    dailySeconds(sessions, "Asia/Manila");
    monthlyHours(sessions, "Asia/Manila");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(sessions).toHaveLength(1);
  });

  it("rejects year 9999 and sessions over a week, keeps a six day one", () => {
    const { sessions, skipped } = parseClaudeCodeLog(
      hookLog(
        entry(at("9999-01-01T00:00:00Z"), at("9999-01-01T01:00:00Z")),
        entry(NOW - 8 * 24 * HOUR, NOW - HOUR),
        entry(NOW - 6 * 24 * HOUR, NOW - HOUR),
      ),
      NOW,
    );
    expect(skipped).toBe(2);
    expect(sessions).toHaveLength(1);
  });

  it("recomputes activeSeconds from the times so a forged number cannot skew totals", () => {
    const { sessions } = parseClaudeCodeLog(hookLog(entry(NOW - 2 * HOUR, NOW - HOUR, { activeSeconds: 1e300 })), NOW);
    expect(sessions[0].activeSeconds).toBe(3600);
  });
});

describe("extension log validation", () => {
  const ext = (startedAt: number, endedAt: number) => ({ toolKey: "claude", startedAt, endedAt, externalRef: `e${startedAt}` });
  it("skips sessions on impossible dates, so one bad clock cannot add 90,000 empty chart months", () => {
    const log = { source: "trackhour-extension", version: 1, sessions: [ext(at("9999-01-01T00:00:00Z"), at("9999-01-01T00:01:00Z")), ext(NOW - HOUR, NOW - HOUR + 60_000)] };
    const { sessions, skipped } = parseExtensionLog(log, NOW);
    expect(sessions).toHaveLength(1);
    expect(skipped).toBe(1);
    expect(monthlyHours(sessions, "UTC").length).toBeLessThanOrEqual(1);
  });
});

describe("card text is always well-formed XML", () => {
  const T = at("2026-03-10T09:00:00Z");
  const sessions: Session[] = [
    { id: "a", toolKey: "claude", startedAt: T, endedAt: T + HOUR, activeSeconds: 3600, messageCount: 1, source: "extension", confidence: "measured", importBatchId: null, externalRef: "a" },
  ];
  const data = buildCardData(sessions, [], { now: NOW, timeZone: "UTC" });
  const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

  it("drops control characters and lone surrogates that a stored profile might carry", () => {
    for (const evil of ["\u0000\u0001\u001f", "ok\uD800", "\uDC00x", "a￿b"]) {
      const hostile = { ...data, all: { ...data.all, sessionCount: evil as unknown as number, mostActiveMonth: evil, currentStreak: evil as unknown as number } };
      const svg = renderCard({ ...DEFAULT_CARD_CONFIG, layout: "showcase", stats: ["hoursOnRecord", "sessions", "currentStreak", "mostActiveMonth"] }, hostile);
      expect(ILLEGAL.test(svg)).toBe(false);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(svg)).toBe(false);
    }
  });

  it("keeps normal text, emoji included", () => {
    const svg = renderCard({ ...DEFAULT_CARD_CONFIG, title: "Mark 🚀" }, data);
    expect(svg).toContain("Mark 🚀");
  });
});
