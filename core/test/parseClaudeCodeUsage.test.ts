import { describe, expect, it } from "vitest";
import { aggregateClaudeCodeUsage, isClaudeCodeUsageLog, parseClaudeCodeUsageLog, type RawTurn } from "../src";
import { at } from "./helpers";

const NOW = at("2026-10-12T12:00:00Z");

function turn(overrides: Partial<RawTurn> = {}): RawTurn {
  return {
    timestamp: at("2026-10-10T09:00:00Z"),
    sessionId: "s1",
    dedupeKey: "m1",
    model: "claude-sonnet-5",
    isSidechain: false,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 100,
    cacheCreationTokens: 5,
    ...overrides,
  };
}

const log = (stats: unknown) => ({ source: "trackhour-claude-code-usage", version: 1, stats });

describe("isClaudeCodeUsageLog", () => {
  it("recognizes the scanner's log shape and rejects everything else", () => {
    expect(isClaudeCodeUsageLog(log({}))).toBe(true);
    expect(isClaudeCodeUsageLog({ source: "trackhour-claude-code-usage" })).toBe(false); // no stats object
    expect(isClaudeCodeUsageLog({ source: "trackhour-claude-code-hook", stats: {} })).toBe(false);
    expect(isClaudeCodeUsageLog([1, 2, 3])).toBe(false);
    expect(isClaudeCodeUsageLog(null)).toBe(false);
  });
});

describe("parseClaudeCodeUsageLog", () => {
  it("round-trips a real aggregateClaudeCodeUsage output through JSON unchanged", () => {
    const stats = aggregateClaudeCodeUsage([turn({ dedupeKey: "a" }), turn({ dedupeKey: "b", model: "claude-opus-4-6" })], { now: () => NOW });
    const parsed = parseClaudeCodeUsageLog(JSON.parse(JSON.stringify(log(stats))));
    expect(parsed).toEqual(stats);
  });

  it("returns null for a file that is not this format, without throwing", () => {
    expect(parseClaudeCodeUsageLog({ foo: 1 })).toBeNull();
    expect(parseClaudeCodeUsageLog([1, 2])).toBeNull();
    expect(parseClaudeCodeUsageLog(null)).toBeNull();
    expect(parseClaudeCodeUsageLog(undefined)).toBeNull();
  });

  it("a usage-log-shaped file with garbage inside normalizes to safe zeros instead of throwing", () => {
    const parsed = parseClaudeCodeUsageLog(
      log({
        usage: "not an object",
        byModel: { "": { outputTokens: 5 } },
        byDay: [{ day: "not-a-date" }, { day: "2026-13-99" }, { day: "2026-03-05", usage: null, messages: -3, sessions: "x" }],
        messageCount: "NaN",
        sidechainMessages: null,
        sessionCount: Infinity,
        activeDays: -5,
        firstActive: "nope",
        lastActive: 9999999999999999,
        generatedAt: "nope",
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 });
    expect(parsed!.byModel).toEqual({}); // empty name and a negative/malformed value both dropped
    // "not-a-date" fails the YYYY-MM-DD shape check and is dropped; "2026-13-99" has the right SHAPE
    // (calendar validity is not checked, matching how day keys are treated elsewhere in the app) and survives.
    expect(parsed!.byDay.map((d) => d.day)).toEqual(["2026-03-05", "2026-13-99"]);
    expect(parsed!.byDay[0]).toEqual({ day: "2026-03-05", usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 }, messages: 0, sessions: 0 });
    expect(parsed!.messageCount).toBe(0);
    expect(parsed!.sidechainMessages).toBe(0);
    expect(parsed!.sessionCount).toBe(0); // Infinity is not finite, rejected
    expect(parsed!.activeDays).toBe(0); // negative rejected
    expect(parsed!.firstActive).toBeNull();
    expect(parsed!.lastActive).toBeNull(); // implausibly far future rejected
  });

  it("a model key with garbage usage values survives with its usage normalized to zero, rather than the whole entry being dropped", () => {
    const parsed = parseClaudeCodeUsageLog(log({ byModel: { "claude-sonnet-5": { outputTokens: -5, cacheReadTokens: "lots" } } }));
    expect(parsed!.byModel).toEqual({ "claude-sonnet-5": { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 } });
  });

  it("strips '<synthetic>' from byModel, even on an older scan file written before this filter existed", () => {
    const parsed = parseClaudeCodeUsageLog(log({ byModel: { "<synthetic>": { outputTokens: 7 }, "claude-sonnet-5": { outputTokens: 10 } } }));
    expect(Object.keys(parsed!.byModel)).toEqual(["claude-sonnet-5"]);
  });

  it("drops unknown extra fields rather than keeping them", () => {
    const parsed = parseClaudeCodeUsageLog(log({ usage: {}, byModel: {}, byDay: [], secretNote: "hi", extra: { sessionId: "leak" } }));
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as object)).not.toContain("secretNote");
    expect(Object.keys(parsed as object)).not.toContain("extra");
  });

  it("days are sorted ascending and capped at a sane count", () => {
    const manyDays = Array.from({ length: 6000 }, (_, i) => ({ day: `2020-01-${String((i % 28) + 1).padStart(2, "0")}`, usage: {}, messages: 1, sessions: 1 }));
    const parsed = parseClaudeCodeUsageLog(log({ byDay: [...manyDays].reverse() }));
    expect(parsed!.byDay.length).toBeLessThanOrEqual(5000);
    const sorted = [...parsed!.byDay].sort((a, b) => (a.day < b.day ? -1 : 1));
    expect(parsed!.byDay).toEqual(sorted);
  });
});
