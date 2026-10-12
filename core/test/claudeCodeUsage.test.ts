import { describe, expect, it } from "vitest";
import { aggregateClaudeCodeUsage, type RawTurn } from "../src/claudeCodeUsage";
import { at, MIN } from "./helpers";

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

describe("dedupe", () => {
  it("collapses a multi-block turn (same dedupeKey, identical usage) into one counted message", () => {
    const base = turn();
    const stats = aggregateClaudeCodeUsage([base, { ...base }, { ...base }], { now: () => NOW });
    expect(stats.messageCount).toBe(1);
    expect(stats.usage.outputTokens).toBe(20); // not 60: counted once, not summed per line
  });

  it("from a growing (streamed) group, keeps the line with the highest outputTokens", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "m1", outputTokens: 50, inputTokens: 3 }), turn({ dedupeKey: "m1", outputTokens: 193, inputTokens: 3 })],
      { now: () => NOW },
    );
    expect(stats.messageCount).toBe(1);
    expect(stats.usage.outputTokens).toBe(193);
  });

  it("turns with different dedupeKeys are both counted", () => {
    const stats = aggregateClaudeCodeUsage([turn({ dedupeKey: "a" }), turn({ dedupeKey: "b" })], { now: () => NOW });
    expect(stats.messageCount).toBe(2);
  });

  it("an empty or missing dedupeKey is never collapsed with another turn", () => {
    const stats = aggregateClaudeCodeUsage([turn({ dedupeKey: "" }), turn({ dedupeKey: "" }), turn({ dedupeKey: "" })], { now: () => NOW });
    expect(stats.messageCount).toBe(3);
  });

  it("order of input does not change the result", () => {
    const a = turn({ dedupeKey: "m1", outputTokens: 50 });
    const b = turn({ dedupeKey: "m1", outputTokens: 193 });
    const x = aggregateClaudeCodeUsage([a, b], { now: () => NOW });
    const y = aggregateClaudeCodeUsage([b, a], { now: () => NOW });
    expect(x.usage.outputTokens).toBe(y.usage.outputTokens);
  });
});

describe("totals", () => {
  it("keeps input, output, cache read and cache creation separate and also sums a grand total", () => {
    const stats = aggregateClaudeCodeUsage([turn({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 4, cacheCreationTokens: 8 })], { now: () => NOW });
    expect(stats.usage).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 4, cacheCreationTokens: 8, totalTokens: 15 });
  });

  it("groups by the raw model id, never a relabeled display name, and sums per model independently", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", model: "claude-opus-4-6", outputTokens: 10 }),
        turn({ dedupeKey: "b", model: "claude-opus-4-6", outputTokens: 20 }),
        turn({ dedupeKey: "c", model: "claude-sonnet-5", outputTokens: 5 }),
      ],
      { now: () => NOW },
    );
    expect(Object.keys(stats.byModel).sort()).toEqual(["claude-opus-4-6", "claude-sonnet-5"]);
    expect(stats.byModel["claude-opus-4-6"].outputTokens).toBe(30);
    expect(stats.byModel["claude-sonnet-5"].outputTokens).toBe(5);
  });

  it("a missing model falls back to 'unknown' instead of throwing or being dropped", () => {
    const stats = aggregateClaudeCodeUsage([turn({ model: "" })], { now: () => NOW });
    expect(stats.byModel.unknown).toBeDefined();
  });

  it("'<synthetic>' is excluded from byModel, but its turn still counts in the overall usage, messageCount and sessions", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", model: "<synthetic>", outputTokens: 7 }),
        turn({ dedupeKey: "b", model: "claude-sonnet-5", outputTokens: 10 }),
      ],
      { now: () => NOW },
    );
    expect(Object.keys(stats.byModel)).toEqual(["claude-sonnet-5"]);
    expect("<synthetic>" in stats.byModel).toBe(false);
    expect(stats.messageCount).toBe(2); // both turns still counted
    expect(stats.usage.outputTokens).toBe(17); // 7 + 10, the synthetic turn's tokens are not dropped from the total
  });

  it("sidechain (sub-agent) turns are included in totals and also counted separately", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "a", isSidechain: false, outputTokens: 10 }), turn({ dedupeKey: "b", isSidechain: true, outputTokens: 10 })],
      { now: () => NOW },
    );
    expect(stats.messageCount).toBe(2);
    expect(stats.usage.outputTokens).toBe(20); // included in the headline total
    expect(stats.sidechainMessages).toBe(1); // but visibly broken out
  });
});

describe("sessions", () => {
  it("turns close together are one session", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "a", timestamp: at("2026-10-10T09:00:00Z") }), turn({ dedupeKey: "b", timestamp: at("2026-10-10T09:10:00Z") })],
      { now: () => NOW },
    );
    expect(stats.sessionCount).toBe(1);
  });

  it("a gap over the session gap starts a new session", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", timestamp: at("2026-10-10T09:00:00Z") }),
        turn({ dedupeKey: "b", timestamp: at("2026-10-10T09:00:00Z") + 16 * MIN }),
      ],
      { now: () => NOW },
    );
    expect(stats.sessionCount).toBe(2);
  });

  it("a gap of exactly the session gap does not split", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", timestamp: at("2026-10-10T09:00:00Z") }),
        turn({ dedupeKey: "b", timestamp: at("2026-10-10T09:00:00Z") + 15 * MIN }),
      ],
      { now: () => NOW },
    );
    expect(stats.sessionCount).toBe(1);
  });

  it("the session gap is a configurable parameter", () => {
    const turns = [
      turn({ dedupeKey: "a", timestamp: at("2026-10-10T09:00:00Z") }),
      turn({ dedupeKey: "b", timestamp: at("2026-10-10T09:00:00Z") + 20 * MIN }),
    ];
    expect(aggregateClaudeCodeUsage(turns, { now: () => NOW }).sessionCount).toBe(2); // default 15 min
    expect(aggregateClaudeCodeUsage(turns, { now: () => NOW, sessionGapMs: 30 * MIN }).sessionCount).toBe(1);
  });

  it("a new Claude Code session id starts a new session even within the gap window (two terminals back to back)", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", sessionId: "s1", timestamp: at("2026-10-10T09:00:00Z") }),
        turn({ dedupeKey: "b", sessionId: "s2", timestamp: at("2026-10-10T09:01:00Z") }),
      ],
      { now: () => NOW },
    );
    expect(stats.sessionCount).toBe(2);
  });

  it("resuming the same session id after a long gap still counts as a new session (the gap rule still applies)", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", sessionId: "s1", timestamp: at("2026-10-10T09:00:00Z") }),
        turn({ dedupeKey: "b", sessionId: "s1", timestamp: at("2026-10-11T09:00:00Z") }),
      ],
      { now: () => NOW },
    );
    expect(stats.sessionCount).toBe(2);
  });

  it("no turns means no sessions, not a crash", () => {
    const stats = aggregateClaudeCodeUsage([], { now: () => NOW });
    expect(stats.sessionCount).toBe(0);
    expect(stats.messageCount).toBe(0);
    expect(stats.activeDays).toBe(0);
    expect(stats.firstActive).toBeNull();
    expect(stats.lastActive).toBeNull();
  });

  it("a single turn is exactly one session", () => {
    const stats = aggregateClaudeCodeUsage([turn()], { now: () => NOW });
    expect(stats.sessionCount).toBe(1);
    expect(stats.messageCount).toBe(1);
  });

  it("two sessions that run AT THE SAME TIME, alternating turns, stay as exactly two sessions, not one per alternation", () => {
    // Mirrors what was found in a real log: two terminals open at once, 08:48-09:39, interleaving
    // every minute or two. The gap-per-id rule must not see the id "change" on every alternation.
    const start = at("2026-10-03T08:48:00Z");
    const turns: RawTurn[] = [];
    for (let i = 0; i < 30; i++) {
      turns.push(turn({ dedupeKey: `a${i}`, sessionId: "sA", timestamp: start + i * 2 * MIN }));
      turns.push(turn({ dedupeKey: `b${i}`, sessionId: "sB", timestamp: start + i * 2 * MIN + MIN }));
    }
    const stats = aggregateClaudeCodeUsage(turns, { now: () => NOW });
    expect(stats.sessionCount).toBe(2);
    expect(stats.messageCount).toBe(60);
  });

  it("an interleaved session still splits in two if ITS OWN gap is exceeded, even while the other id keeps going", () => {
    const start = at("2026-10-03T08:48:00Z");
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a1", sessionId: "sA", timestamp: start }),
        turn({ dedupeKey: "b1", sessionId: "sB", timestamp: start + MIN }),
        turn({ dedupeKey: "b2", sessionId: "sB", timestamp: start + 5 * MIN }), // sB stays active
        // sA comes back after more than 15 minutes of ITS OWN silence, even though sB was active throughout
        turn({ dedupeKey: "a2", sessionId: "sA", timestamp: start + 20 * MIN }),
      ],
      { now: () => NOW },
    );
    expect(stats.sessionCount).toBe(3); // sA(first), sB, sA(resumed)
  });

  it("three sessions, two overlapping and one separate, produce exactly three sessions regardless of interleaving (the real-log case)", () => {
    const turns: RawTurn[] = [];
    // sA and sB overlap and interleave, 08:48-09:39
    const overlapStart = at("2026-10-03T08:48:00Z");
    for (let i = 0; i < 20; i++) {
      turns.push(turn({ dedupeKey: `a${i}`, sessionId: "sA", timestamp: overlapStart + i * 2 * MIN }));
      turns.push(turn({ dedupeKey: `b${i}`, sessionId: "sB", timestamp: overlapStart + i * 2 * MIN + MIN }));
    }
    // sC runs alone that night, no overlap
    const soloStart = at("2026-10-03T22:53:00Z");
    for (let i = 0; i < 5; i++) turns.push(turn({ dedupeKey: `c${i}`, sessionId: "sC", timestamp: soloStart + i * 5 * MIN }));
    const stats = aggregateClaudeCodeUsage(turns, { now: () => NOW });
    expect(stats.sessionCount).toBe(3);
  });
});

describe("days", () => {
  it("buckets by local day in the given time zone", () => {
    // 23:30 UTC on Oct 9 is already Oct 10 in UTC+1
    const stats = aggregateClaudeCodeUsage([turn({ timestamp: at("2026-10-09T23:30:00Z") })], { now: () => NOW, timeZone: "Etc/GMT-1" });
    expect(stats.byDay.map((d) => d.day)).toEqual(["2026-10-10"]);
  });

  it("activeDays matches the number of distinct days with activity", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", timestamp: at("2026-10-10T09:00:00Z") }),
        turn({ dedupeKey: "b", timestamp: at("2026-10-11T09:00:00Z") }),
        turn({ dedupeKey: "c", timestamp: at("2026-10-11T10:00:00Z") }),
      ],
      { now: () => NOW, timeZone: "UTC" },
    );
    expect(stats.activeDays).toBe(2);
    expect(stats.byDay.find((d) => d.day === "2026-10-11")?.messages).toBe(2);
  });

  it("a session spanning midnight counts on both days it touches", () => {
    const stats = aggregateClaudeCodeUsage(
      [
        turn({ dedupeKey: "a", timestamp: at("2026-10-10T23:50:00Z") }),
        turn({ dedupeKey: "b", timestamp: at("2026-10-11T00:05:00Z") }),
      ],
      { now: () => NOW, timeZone: "UTC" },
    );
    expect(stats.sessionCount).toBe(1);
    expect(stats.byDay.find((d) => d.day === "2026-10-10")?.sessions).toBe(1);
    expect(stats.byDay.find((d) => d.day === "2026-10-11")?.sessions).toBe(1);
  });

  it("days are returned in ascending order", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "a", timestamp: at("2026-10-11T09:00:00Z") }), turn({ dedupeKey: "b", timestamp: at("2026-10-09T09:00:00Z") })],
      { now: () => NOW },
    );
    expect(stats.byDay.map((d) => d.day)).toEqual(["2026-10-09", "2026-10-11"]);
  });
});

describe("defensive against bad input", () => {
  it("non-finite or negative token fields become 0 instead of corrupting the total", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ inputTokens: NaN, outputTokens: Infinity, cacheReadTokens: -5, cacheCreationTokens: 0 })],
      { now: () => NOW },
    );
    expect(stats.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 });
  });

  it("an implausible timestamp (placeholder 1970, or far future) is dropped entirely rather than skewing the range", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "a", timestamp: 0 }), turn({ dedupeKey: "b", timestamp: at("9999-01-01T00:00:00Z") }), turn({ dedupeKey: "c" })],
      { now: () => NOW },
    );
    expect(stats.messageCount).toBe(1);
  });

  it("generatedAt is injected, never the real clock", () => {
    const stats = aggregateClaudeCodeUsage([turn()], { now: () => 123456 });
    expect(stats.generatedAt).toBe(123456);
  });
});

describe("privacy: no identifiers ever reach the output", () => {
  it("ClaudeCodeUsageStats has no field for sessionId, dedupeKey, uuid or requestId", () => {
    const stats = aggregateClaudeCodeUsage([turn()], { now: () => NOW });
    const keys = new Set(Object.keys(stats));
    for (const forbidden of ["sessionId", "dedupeKey", "uuid", "requestId", "messageId"]) expect(keys.has(forbidden)).toBe(false);
    for (const day of stats.byDay) {
      for (const forbidden of ["sessionId", "dedupeKey", "uuid", "requestId", "sessionIds", "sessionIndexes"]) {
        expect(Object.keys(day)).not.toContain(forbidden);
      }
    }
  });

  it("the serialized output never contains the raw session id, dedupe key or any distinguishing identifier string", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ sessionId: "VERY-SECRET-SESSION-ID", dedupeKey: "VERY-SECRET-MESSAGE-ID" })],
      { now: () => NOW },
    );
    const json = JSON.stringify(stats);
    expect(json).not.toContain("SECRET");
  });
});
