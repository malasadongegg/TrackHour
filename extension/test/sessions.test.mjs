import { test } from "node:test";
import assert from "node:assert/strict";
import { BEAT_MS, JOIN_GAP_MS, activeSecondsSince, addBeat, emptyState, settle, toLog } from "../src/sessions.js";

const T = Date.UTC(2026, 2, 10, 9, 0, 0);

test("a run of beats becomes one session whose length is its active time", () => {
  const s = emptyState();
  for (let i = 0; i < 6; i++) addBeat(s, "claude", T + i * BEAT_MS); // 6 beats, 50s apart first to last
  assert.equal(s.sessions.length, 0, "still open, not exported yet");
  settle(s, T + 10 * 60_000);
  assert.equal(s.sessions.length, 1);
  const x = s.sessions[0];
  assert.equal(x.startedAt, T - BEAT_MS);
  assert.equal(x.endedAt, T + 5 * BEAT_MS);
  assert.equal(x.activeSeconds, 60);
  assert.equal(x.endedAt - x.startedAt, x.activeSeconds * 1000); // invariant the web app relies on
  assert.equal(x.externalRef, `extension:claude:${x.startedAt}`);
});

test("a silence longer than the join gap splits into two non-overlapping sessions", () => {
  const s = emptyState();
  addBeat(s, "claude", T);
  addBeat(s, "claude", T + BEAT_MS);
  addBeat(s, "claude", T + BEAT_MS + JOIN_GAP_MS + 1);
  settle(s, T + 3_600_000);
  assert.equal(s.sessions.length, 2);
  assert.ok(s.sessions[0].endedAt <= s.sessions[1].startedAt);
});

test("a gap of exactly the join gap does not split", () => {
  const s = emptyState();
  addBeat(s, "claude", T);
  addBeat(s, "claude", T + JOIN_GAP_MS);
  settle(s, T + 3_600_000);
  assert.equal(s.sessions.length, 1);
});

test("tools are tracked independently", () => {
  const s = emptyState();
  addBeat(s, "claude", T);
  addBeat(s, "chatgpt", T + 1000);
  addBeat(s, "claude", T + BEAT_MS);
  settle(s, T + 3_600_000);
  assert.deepEqual(s.sessions.map((x) => x.toolKey).sort(), ["chatgpt", "claude"]);
});

test("ignores unknown tools, bad times, and everything while paused", () => {
  const s = emptyState();
  addBeat(s, "claude_code", T);
  addBeat(s, "claude", NaN);
  s.paused = true;
  addBeat(s, "claude", T);
  settle(s, T + 3_600_000);
  assert.equal(s.sessions.length, 0);
  assert.deepEqual(s.open, {});
});

test("a clock that moves backwards closes the session instead of corrupting it", () => {
  const s = emptyState();
  addBeat(s, "claude", T + 100_000);
  addBeat(s, "claude", T); // earlier than the last beat
  settle(s, T + 3_600_000);
  for (const x of s.sessions) assert.ok(x.endedAt > x.startedAt);
});

test("settle keeps a session open while beats are recent", () => {
  const s = emptyState();
  addBeat(s, "claude", T);
  settle(s, T + JOIN_GAP_MS);
  assert.equal(s.sessions.length, 0);
  assert.ok(s.open.claude);
});

test("toLog exports only finished sessions in the shape the web app parses", () => {
  const s = emptyState();
  addBeat(s, "claude", T);
  settle(s, T + 3_600_000);
  addBeat(s, "chatgpt", T + 3_700_000); // still open
  const log = toLog(s);
  assert.equal(log.source, "trackhour-extension");
  assert.equal(log.version, 1);
  assert.equal(log.sessions.length, 1);
  assert.deepEqual(Object.keys(log.sessions[0]).sort(), ["activeSeconds", "endedAt", "externalRef", "id", "messageCount", "startedAt", "toolKey"]);
});

test("activeSecondsSince counts finished and in-progress time, clipped to the window", () => {
  const s = emptyState();
  addBeat(s, "claude", T);
  addBeat(s, "claude", T + BEAT_MS);
  settle(s, T + 3_600_000);
  addBeat(s, "claude", T + 4_000_000);
  const all = activeSecondsSince(s, 0);
  assert.equal(all.claude, 20 + 10); // 20s finished session + 10s open one
  assert.equal(activeSecondsSince(s, T + 3_900_000).claude, 10);
  assert.equal(all.chatgpt, 0);
});

test("the idle tail after the last real input is not credited", () => {
  const s = emptyState();
  // Input until T+20s, then beats keep coming (recent-input window) until T+60s with growing idle time.
  for (let t = 0; t <= 60_000; t += BEAT_MS) addBeat(s, "claude", T + t, Math.max(0, t - 20_000));
  settle(s, T + 3_600_000);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].startedAt, T - BEAT_MS);
  assert.equal(s.sessions[0].endedAt, T + 20_000 + BEAT_MS); // last input + one beat, not T+60s
  assert.equal(s.sessions[0].activeSeconds, 40);
});

test("a session made only of idle beats is dropped", () => {
  const s = emptyState();
  // Tab refocused with the last input 80s ago and nothing touched since.
  for (let t = 0; t <= 30_000; t += BEAT_MS) addBeat(s, "claude", T + t, 80_000 + t);
  settle(s, T + 3_600_000);
  assert.equal(s.sessions.length, 0);
});

test("input later in an idle-started run makes it a real session, never ending past its last beat", () => {
  const s = emptyState();
  addBeat(s, "claude", T, 80_000);
  addBeat(s, "claude", T + BEAT_MS, 2_000); // touched 2s before this beat
  settle(s, T + 3_600_000);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0].endedAt, T + BEAT_MS); // last input + one beat would be later, but the last beat caps it
});

test("activeSecondsSince also trims the idle tail of a session still in progress", () => {
  const s = emptyState();
  for (let t = 0; t <= 60_000; t += BEAT_MS) addBeat(s, "claude", T + t, Math.max(0, t - 20_000));
  assert.equal(activeSecondsSince(s, 0).claude, 40);
});
