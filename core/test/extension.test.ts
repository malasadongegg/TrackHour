import { describe, expect, it } from "vitest";
import { combineSessions, isExtensionLog, parseExtensionLog } from "../src";
import { at, rec } from "./helpers";
import { sessionize } from "../src/sessionize";

const T = at("2026-03-10T09:00:00Z");
const MIN = 60_000;

function entry(toolKey: string, startedAt: number, endedAt: number, extra: Record<string, unknown> = {}) {
  return { toolKey, startedAt, endedAt, activeSeconds: 999, messageCount: 7, externalRef: `extension:${toolKey}:${startedAt}`, ...extra };
}

const log = (sessions: unknown[]) => ({ source: "trackhour-extension", version: 1, sessions });

describe("isExtensionLog", () => {
  it("recognizes the extension log and rejects everything else", () => {
    expect(isExtensionLog(log([]))).toBe(true);
    expect(isExtensionLog({ source: "trackhour-claude-code-hook", sessions: [] })).toBe(false);
    expect(isExtensionLog({ source: "trackhour-extension" })).toBe(false);
    expect(isExtensionLog(null)).toBe(false);
  });
});

describe("parseExtensionLog", () => {
  it("parses entries into measured extension sessions and recomputes activeSeconds from the times", () => {
    const { sessions, skipped } = parseExtensionLog(log([entry("claude", T, T + 10 * MIN), entry("chatgpt", T, T + MIN)]));
    expect(skipped).toBe(0);
    expect(sessions).toHaveLength(2);
    const s = sessions[0];
    expect(s.source).toBe("extension");
    expect(s.confidence).toBe("measured");
    expect(s.toolKey).toBe("claude");
    expect(s.activeSeconds).toBe(600); // from the times, not the claimed 999
    expect(s.messageCount).toBe(0); // the extension never counts messages
    expect(s.importBatchId).toBeNull();
  });

  it("skips malformed, wrong-tool, inverted and implausibly long entries but keeps good ones", () => {
    const bad = [
      {},
      entry("claude_code", T, T + MIN), // not a browser tool
      entry("claude", T + MIN, T), // ends before it starts
      entry("claude", T, T), // zero length
      entry("claude", T, T + 25 * 3_600_000), // over a day
      { toolKey: "claude", startedAt: T, endedAt: T + MIN, externalRef: "" },
    ];
    const { sessions, skipped } = parseExtensionLog(log([...bad, entry("claude", T, T + MIN)]));
    expect(sessions).toHaveLength(1);
    expect(skipped).toBe(bad.length);
  });

  it("returns nothing for other file shapes without throwing", () => {
    expect(parseExtensionLog({ foo: 1 })).toEqual({ sessions: [], skipped: 0 });
    expect(parseExtensionLog(null)).toEqual({ sessions: [], skipped: 0 });
  });

  it("measured extension time replaces the overlapping part of an imported estimate", () => {
    const est = sessionize([rec("claude", [T, T + 60 * MIN])], "claude", { inactivityGapMs: 2 * 3_600_000 });
    const { sessions: meas } = parseExtensionLog(log([entry("claude", T + 10 * MIN, T + 20 * MIN)]));
    const total = combineSessions(est, meas).reduce((n, s) => n + s.activeSeconds, 0);
    expect(total).toBe(60 * 60); // 60 min estimate, 10 of which are now measured instead
  });
});
