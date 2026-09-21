import { test } from "node:test";
import assert from "node:assert/strict";
import { IDLE_GAP_MS, MIN_SESSION_MS, WORKING_GAP_MS, belongsTo, buildSessions, linesForToolCall, newState, record, upgradeState } from "../hook-core.mjs";

const T = Date.UTC(2026, 8, 21, 9, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Play events as [kind, minutesAfterT, lines?] and end the session at `endMin`. */
function run(events, endMin) {
  const s = newState(T);
  for (const [kind, min, lines] of events) record(s, kind, T + min * MIN, lines ?? 0);
  return buildSessions(s, "sess", T + endMin * MIN);
}

test("a normal working session is one session as long as the activity", () => {
  const out = run([["prompt", 0], ["tool", 2, 10], ["stop", 5], ["prompt", 7], ["stop", 15]], 16);
  assert.equal(out.length, 1);
  assert.equal(out[0].activeSeconds, 15 * 60);
  assert.equal(out[0].endedAt - out[0].startedAt, out[0].activeSeconds * 1000); // invariant the web app relies on
});

test("a terminal left open overnight is NOT counted as a 12 hour session", () => {
  const out = run([["prompt", 0], ["stop", 20]], 12 * 60);
  assert.equal(out.length, 1);
  assert.equal(out[0].activeSeconds, 20 * 60); // ended at the last activity, not at SessionEnd
});

test("stepping away longer than the idle gap splits the session and the gap is not counted", () => {
  const out = run([["prompt", 0], ["stop", 5], ["prompt", 5 + IDLE_GAP_MS / MIN + 1], ["stop", 5 + IDLE_GAP_MS / MIN + 6]], 40);
  assert.equal(out.length, 2);
  assert.equal(out[0].activeSeconds, 5 * 60);
  assert.equal(out[1].activeSeconds, 5 * 60);
  assert.ok(out[0].endedAt <= out[1].startedAt);
});

test("a gap of exactly the idle gap does not split", () => {
  const out = run([["prompt", 0], ["stop", 5], ["prompt", 5 + IDLE_GAP_MS / MIN]], 30);
  assert.equal(out.length, 1);
});

test("Claude working a long time between prompt and stop is counted in full", () => {
  const out = run([["prompt", 0], ["tool", 12, 3], ["tool", 30, 3], ["stop", 45]], 46);
  assert.equal(out.length, 1);
  assert.equal(out[0].activeSeconds, 45 * 60);
});

test("but silence longer than the working gap even mid-reply splits (an interrupted reply leaves no stop)", () => {
  const out = run([["prompt", 0], ["tool", 3], ["prompt", 3 + WORKING_GAP_MS / MIN + 1], ["stop", 3 + WORKING_GAP_MS / MIN + 4]], 200);
  assert.equal(out.length, 2);
});

test("ending while Claude is mid-reply runs to the end time if that is recent, otherwise to the last activity", () => {
  assert.equal(run([["prompt", 0], ["tool", 4]], 9)[0].activeSeconds, 9 * 60); // quit 5 minutes after the last tool call, reply still running
  assert.equal(run([["prompt", 0], ["tool", 4]], 4 + WORKING_GAP_MS / MIN + 60)[0].activeSeconds, 4 * 60); // abandoned
});

test("a session with a single event is floored to one minute", () => {
  const out = run([["start", 0]], 0);
  assert.equal(out[0].activeSeconds, MIN_SESSION_MS / 1000);
});

test("lines and tool calls are counted in the stretch they happened in", () => {
  const out = run([["prompt", 0], ["tool", 1, 10], ["tool", 2, 5], ["stop", 3], ["prompt", 60], ["tool", 61, 7], ["stop", 62]], 63);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].messageCount, out[0].linesChanged], [2, 15]);
  assert.deepEqual([out[1].messageCount, out[1].linesChanged], [1, 7]);
});

test("each stretch gets its own stable reference, prefixed by the session id", () => {
  const out = run([["prompt", 0], ["stop", 1], ["prompt", 90], ["stop", 91]], 92);
  assert.deepEqual(out.map((s) => s.externalRef), ["sess#0", "sess#1"]);
  assert.ok(out.every((s) => belongsTo(s.externalRef, "sess")));
  assert.ok(belongsTo("sess", "sess")); // entries written by the previous version used the bare id
  assert.ok(!belongsTo("sess2#0", "sess"));
  assert.ok(!belongsTo("other", "sess"));
});

test("a clock that moves backwards never produces a negative or inverted session", () => {
  const out = run([["prompt", 10], ["tool", 5], ["stop", 3]], 20);
  for (const s of out) assert.ok(s.endedAt > s.startedAt);
});

test("junk timestamps are ignored", () => {
  const s = newState(T);
  record(s, "prompt", NaN);
  record(s, "tool", undefined);
  assert.equal(buildSessions(s, "x", T).length, 1);
});

test("a state file written by the previous hook version still ends cleanly", () => {
  const old = { startedAt: T, toolCalls: 4, linesChanged: 120 };
  const s = upgradeState(old, T + 5 * MIN);
  record(s, "stop", T + 5 * MIN);
  const out = buildSessions(s, "old", T + 6 * MIN);
  assert.ok(out.length >= 1);
  assert.equal(out.reduce((n, x) => n + x.linesChanged, 0), 120);
});

test("upgradeState leaves a current state alone and survives garbage", () => {
  const s = newState(T);
  assert.equal(upgradeState(s, T), s);
  assert.doesNotThrow(() => upgradeState(null, T));
  assert.doesNotThrow(() => upgradeState("nope", T));
});

test("sessions have exactly the shape the web app parses", () => {
  const [x] = run([["prompt", 0], ["stop", 2]], 3);
  assert.deepEqual(Object.keys(x).sort(), ["activeSeconds", "confidence", "endedAt", "externalRef", "id", "importBatchId", "linesChanged", "messageCount", "source", "startedAt", "toolKey"]);
  assert.equal(x.toolKey, "claude_code");
  assert.equal(x.source, "code_hook");
  assert.equal(x.confidence, "measured");
});

test("line counting matches the previous rules for every edit tool", () => {
  assert.equal(linesForToolCall("Edit", { old_string: "a\nb", new_string: "c" }), 3);
  assert.equal(linesForToolCall("Write", { content: "1\n2\n3" }), 3);
  assert.equal(linesForToolCall("MultiEdit", { edits: [{ old_string: "a", new_string: "b\nc" }, { old_string: "", new_string: "d" }] }), 4);
  assert.equal(linesForToolCall("NotebookEdit", { new_source: "x\ny" }), 2);
  assert.equal(linesForToolCall("Bash", { command: "ls" }), 0);
  assert.equal(linesForToolCall("Edit", null), 0);
});
