import { describe, expect, it } from "vitest";
import { sessionize } from "../src/sessionize";
import { MIN, at, rec } from "./helpers";

const T0 = at("2026-03-02T09:00:00Z");

describe("sessionize", () => {
  it("returns nothing when there is no activity", () => {
    expect(sessionize([], "chatgpt")).toEqual([]);
  });

  it("splits when the gap EXCEEDS the threshold, not when it equals it", () => {
    const equal = sessionize([rec("chatgpt", [T0, T0 + 15 * MIN])], "chatgpt");
    expect(equal).toHaveLength(1);
    expect(equal[0].activeSeconds).toBe(15 * 60);

    const over = sessionize([rec("chatgpt", [T0, T0 + 15 * MIN + 1])], "chatgpt");
    expect(over).toHaveLength(2);
  });

  it("measures duration as last minus first timestamp", () => {
    const [s] = sessionize([rec("claude", [T0, T0 + 4 * MIN, T0 + 10 * MIN])], "claude");
    expect(s.activeSeconds).toBe(10 * 60);
    expect(s.startedAt).toBe(T0);
    expect(s.endedAt).toBe(T0 + 10 * MIN);
  });

  it("floors a single-timestamp session to the minimum", () => {
    const [s] = sessionize([rec("chatgpt", [T0])], "chatgpt");
    expect(s.activeSeconds).toBe(60);
    expect(s.endedAt - s.startedAt).toBe(60_000);
  });

  it("floors a very short session but leaves longer ones alone", () => {
    const [short] = sessionize([rec("chatgpt", [T0, T0 + 20_000])], "chatgpt");
    expect(short.activeSeconds).toBe(60);
    const [long] = sessionize([rec("chatgpt", [T0, T0 + 90_000])], "chatgpt");
    expect(long.activeSeconds).toBe(90);
  });

  it("merges timestamps from different conversations into one session", () => {
    const a = rec("chatgpt", [T0, T0 + 5 * MIN], { externalRef: "a" });
    const b = rec("chatgpt", [T0 + 3 * MIN, T0 + 8 * MIN], { externalRef: "b" });
    const sessions = sessionize([a, b], "chatgpt");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].activeSeconds).toBe(8 * 60);
    expect(sessions[0].messageCount).toBe(4);
  });

  it("only uses records for the requested tool", () => {
    const chat = rec("chatgpt", [T0]);
    const claude = rec("claude", [T0 + 60 * MIN]);
    expect(sessionize([chat, claude], "claude")).toHaveLength(1);
    expect(sessionize([chat, claude], "claude_code")).toEqual([]);
  });

  it("honors custom options", () => {
    const r = rec("chatgpt", [T0, T0 + 5 * MIN]);
    expect(sessionize([r], "chatgpt", { inactivityGapMs: 2 * MIN })).toHaveLength(2);
    const [s] = sessionize([rec("chatgpt", [T0])], "chatgpt", { minSessionMs: 3 * MIN });
    expect(s.activeSeconds).toBe(180);
  });

  it("attributes counted messages only, not every activity timestamp", () => {
    const r = rec("chatgpt", [T0, T0 + MIN, T0 + 2 * MIN], { messageTimes: [T0, T0 + 2 * MIN] });
    expect(sessionize([r], "chatgpt")[0].messageCount).toBe(2);
  });

  it("labels derived sessions as estimated imports with a deterministic ref", () => {
    const [s] = sessionize([rec("chatgpt", [T0])], "chatgpt");
    expect(s.source).toBe("import");
    expect(s.confidence).toBe("estimated");
    expect(s.importBatchId).toBeNull();
    expect(s.externalRef).toBe(`chatgpt:${T0}`);
  });

  it("is deterministic regardless of record order", () => {
    const a = rec("chatgpt", [T0, T0 + MIN], { externalRef: "a" });
    const b = rec("chatgpt", [T0 + 60 * MIN], { externalRef: "b" });
    expect(sessionize([a, b], "chatgpt")).toEqual(sessionize([b, a], "chatgpt"));
  });
});
