import { describe, expect, it } from "vitest";
import { combineSessions, isClaudeCodeLog, parseClaudeCodeLog } from "../src";
import { at, rec } from "./helpers";
import { sessionize } from "../src/sessionize";

const T = at("2026-03-10T09:00:00Z");

function entry(externalRef: string, startedAt: number, endedAt: number, extra: Record<string, unknown> = {}) {
  return {
    toolKey: "claude_code",
    startedAt,
    endedAt,
    activeSeconds: (endedAt - startedAt) / 1000,
    messageCount: 3,
    linesChanged: 42,
    externalRef,
    ...extra,
  };
}

function log(sessions: unknown[]) {
  return { source: "trackhour-claude-code-hook", version: 1, sessions };
}

describe("isClaudeCodeLog", () => {
  it("recognizes the hook's log shape and rejects everything else", () => {
    expect(isClaudeCodeLog(log([]))).toBe(true);
    expect(isClaudeCodeLog({ source: "trackhour-claude-code-hook" })).toBe(false); // no sessions array
    expect(isClaudeCodeLog({ source: "something-else", sessions: [] })).toBe(false);
    expect(isClaudeCodeLog([1, 2, 3])).toBe(false);
    expect(isClaudeCodeLog(null)).toBe(false);
  });
});

describe("parseClaudeCodeLog", () => {
  it("parses valid entries into proper Sessions, tagged measured/code_hook", () => {
    const { sessions, skipped } = parseClaudeCodeLog(log([entry("s1", T, T + 600_000)]));
    expect(skipped).toBe(0);
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s.toolKey).toBe("claude_code");
    expect(s.source).toBe("code_hook");
    expect(s.confidence).toBe("measured");
    expect(s.importBatchId).toBeNull();
    expect(s.externalRef).toBe("s1");
    expect(s.activeSeconds).toBe(600);
    expect(s.messageCount).toBe(3);
    expect(s.linesChanged).toBe(42);
  });

  it("returns nothing for a file that is not this format, without throwing", () => {
    expect(parseClaudeCodeLog({ foo: 1 })).toEqual({ sessions: [], skipped: 0 });
    expect(parseClaudeCodeLog([1, 2])).toEqual({ sessions: [], skipped: 0 });
    expect(parseClaudeCodeLog(null)).toEqual({ sessions: [], skipped: 0 });
  });

  it("skips malformed entries instead of throwing, and keeps the valid ones", () => {
    const bad = [
      {},
      { toolKey: "chatgpt", startedAt: T, endedAt: T + 1000, activeSeconds: 1, messageCount: 1, externalRef: "x" }, // wrong tool
      { toolKey: "claude_code", startedAt: T, endedAt: T - 1000, activeSeconds: 1, messageCount: 1, externalRef: "x" }, // ended before it started
      { toolKey: "claude_code", startedAt: T, endedAt: T + 1000, activeSeconds: -1, messageCount: 1, externalRef: "x" }, // negative duration
      { toolKey: "claude_code", startedAt: T, endedAt: T + 1000, activeSeconds: 1, messageCount: 1, externalRef: "" }, // empty ref
      { toolKey: "claude_code", startedAt: T, endedAt: T + 1000, activeSeconds: 1, messageCount: 1, externalRef: "y", linesChanged: "lots" }, // wrong type
    ];
    const { sessions, skipped } = parseClaudeCodeLog(log([...bad, entry("good", T, T + 60_000)]));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].externalRef).toBe("good");
    expect(skipped).toBe(bad.length);
  });

  it("does not require linesChanged", () => {
    const { sessions } = parseClaudeCodeLog(log([entry("s1", T, T + 60_000, { linesChanged: undefined })]));
    expect(sessions[0].linesChanged).toBeUndefined();
  });

  it("drops unknown fields and never trusts a claimed source/confidence in the file", () => {
    const { sessions } = parseClaudeCodeLog(log([entry("s1", T, T + 60_000, { source: "import", confidence: "estimated", secretNote: "hi" })]));
    expect(sessions[0].source).toBe("code_hook");
    expect(sessions[0].confidence).toBe("measured");
    expect((sessions[0] as unknown as Record<string, unknown>).secretNote).toBeUndefined();
  });
});

describe("backfill logs", () => {
  const backfill = (sessions: unknown[]) => ({ source: "trackhour-claude-code-backfill", version: 1, sessions });

  it("is recognized as a Claude Code log", () => {
    expect(isClaudeCodeLog(backfill([]))).toBe(true);
  });

  it("parses into estimated import sessions, whatever the entries claim", () => {
    const { sessions } = parseClaudeCodeLog(backfill([entry("claude_code:1", T, T + 600_000, { source: "code_hook", confidence: "measured" })]));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].source).toBe("import");
    expect(sessions[0].confidence).toBe("estimated");
    expect(sessions[0].linesChanged).toBe(42);
  });

  it("is overridden by a measured hook session that overlaps it", () => {
    const { sessions: est } = parseClaudeCodeLog(backfill([entry("claude_code:1", T, T + 600_000)]));
    const { sessions: meas } = parseClaudeCodeLog(log([entry("live", T - 60_000, T + 660_000)]));
    expect(combineSessions(est, meas).map((s) => s.externalRef)).toEqual(["live"]);
  });
});

describe("combineSessions", () => {
  const HOUR = 3_600_000;

  it("keeps estimated sessions on days a measured source never covered", () => {
    const estimated = sessionize([rec("claude_code", [T])], "claude_code"); // not realistic, just a stand-in tool
    const combined = combineSessions(estimated, []);
    expect(combined).toEqual(estimated);
  });

  it("cuts measured time out of an estimated session for that tool only", () => {
    const estStart = at("2026-03-10T09:00:00Z");
    const estimatedCC = sessionize([rec("claude_code", [estStart, estStart + 4 * HOUR])], "claude_code", { inactivityGapMs: 5 * HOUR });
    const estimatedOther = sessionize([rec("chatgpt", [estStart])], "chatgpt");
    const measured = [
      { id: "m1", toolKey: "claude_code" as const, startedAt: estStart + HOUR, endedAt: estStart + 2 * HOUR, activeSeconds: 3600, messageCount: 5, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "m1" },
    ];
    const combined = combineSessions([...estimatedCC, ...estimatedOther], measured);
    expect(combined).toContainEqual(measured[0]);
    expect(combined.filter((s) => s.toolKey === "chatgpt")).toEqual(estimatedOther); // untouched: different tool
    const cc = combined.filter((s) => s.toolKey === "claude_code" && s.confidence === "estimated");
    expect(cc.map((s) => [s.startedAt, s.endedAt])).toEqual([
      [estStart, estStart + HOUR],
      [estStart + 2 * HOUR, estStart + 4 * HOUR],
    ]);
    // Total time: 4h estimate minus the 1h measured stretch, plus the 1h measured session itself.
    expect(combined.filter((s) => s.toolKey === "claude_code").reduce((n, s) => n + s.activeSeconds, 0)).toBe(4 * 3600);
  });

  it("a short measured session does not erase the rest of a long estimated day", () => {
    const estStart = at("2026-03-10T09:00:00Z");
    const est = sessionize([rec("claude_code", [estStart, estStart + 3 * HOUR])], "claude_code", { inactivityGapMs: 4 * HOUR });
    const tiny = [
      { id: "m", toolKey: "claude_code" as const, startedAt: estStart + HOUR, endedAt: estStart + HOUR + 60_000, activeSeconds: 60, messageCount: 0, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "m" },
    ];
    const total = combineSessions(est, tiny).reduce((n, s) => n + s.activeSeconds, 0);
    expect(total).toBe(3 * 3600);
  });

  it("keeps an estimated session that a measured one does not overlap, even on the same day", () => {
    const earlier = sessionize([rec("claude_code", [T])], "claude_code");
    const measured = [
      { id: "m1", toolKey: "claude_code" as const, startedAt: T + 5 * HOUR, endedAt: T + 6 * HOUR, activeSeconds: 3600, messageCount: 1, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "m1" },
    ];
    expect(combineSessions(earlier, measured)).toEqual([...earlier, ...measured]);
  });

  it("drops an estimated session fully covered by a measured one", () => {
    const est = sessionize([rec("claude_code", [T])], "claude_code"); // 1 minute floor
    const measured = [
      { id: "m1", toolKey: "claude_code" as const, startedAt: T - HOUR, endedAt: T + HOUR, activeSeconds: 7200, messageCount: 1, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "m1" },
    ];
    expect(combineSessions(est, measured)).toEqual(measured);
  });
});
