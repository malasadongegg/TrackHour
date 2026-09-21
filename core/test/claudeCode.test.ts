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

describe("combineSessions", () => {
  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  it("keeps estimated sessions on days a measured source never covered", () => {
    const estimated = sessionize([rec("claude_code", [T])], "claude_code"); // not realistic, just a stand-in tool
    const combined = combineSessions(estimated, [], "UTC");
    expect(combined).toEqual(estimated);
  });

  it("drops estimated sessions for a tool on days a measured session covers, for that tool only", () => {
    const estStart = at("2026-03-10T09:00:00Z");
    const estimatedCC = sessionize([rec("claude_code", [estStart])], "claude_code");
    const estimatedOther = sessionize([rec("chatgpt", [estStart])], "chatgpt");
    const measured = [
      { id: "m1", toolKey: "claude_code" as const, startedAt: estStart + HOUR, endedAt: estStart + 2 * HOUR, activeSeconds: 3600, messageCount: 5, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "m1" },
    ];
    const combined = combineSessions([...estimatedCC, ...estimatedOther], measured, "UTC");
    expect(combined).toContainEqual(measured[0]);
    expect(combined.filter((s) => s.toolKey === "claude_code")).toEqual([measured[0]]); // the estimated claude_code session is gone
    expect(combined.filter((s) => s.toolKey === "chatgpt")).toEqual(estimatedOther); // untouched: different tool
  });

  it("keeps an estimated session on an earlier day even if the tool has measured coverage on a later day", () => {
    const earlier = sessionize([rec("claude_code", [T])], "claude_code");
    const measured = [
      { id: "m1", toolKey: "claude_code" as const, startedAt: T + DAY, endedAt: T + DAY + HOUR, activeSeconds: 3600, messageCount: 1, source: "code_hook" as const, confidence: "measured" as const, importBatchId: null, externalRef: "m1" },
    ];
    const combined = combineSessions(earlier, measured, "UTC");
    expect(combined).toEqual([...earlier, ...measured]);
  });

  it("covers every day a measured session spans, including across midnight", () => {
    const spanning = {
      id: "m1",
      toolKey: "claude_code" as const,
      startedAt: at("2026-03-10T23:50:00Z"),
      endedAt: at("2026-03-11T00:10:00Z"),
      activeSeconds: 1200,
      messageCount: 1,
      source: "code_hook" as const,
      confidence: "measured" as const,
      importBatchId: null,
      externalRef: "m1",
    };
    const estOnNextDay = sessionize([rec("claude_code", [at("2026-03-11T08:00:00Z")])], "claude_code");
    const combined = combineSessions(estOnNextDay, [spanning], "UTC");
    // Mar 11 is covered by the spanning measured session, so the estimated Mar 11 session is dropped too.
    expect(combined).toEqual([spanning]);
  });
});
