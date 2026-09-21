/**
 * Turns "the user was active right now" beats into sessions. Pure functions on
 * a plain state object, so they are unit tested without a browser
 * (extension/test/sessions.test.mjs).
 *
 * The page script sends one beat every BEAT_MS while the tab is visible, the
 * window is focused, and the user touched the page recently. A beat at time t
 * stands for the BEAT_MS before it, and says how long ago the last real input
 * was. Beats no more than JOIN_GAP_MS apart belong to the same session; a
 * longer silence closes it and the next beat opens a new one.
 *
 * Beats keep coming for a while after the user stops touching the page (the
 * "recent input" window), so a session ENDS at the last real input plus one
 * beat, not at the last beat. That keeps idle tail time out of the total, and a
 * session whose only beats were idle (tab refocused, nothing touched) is
 * dropped. A session's duration is exactly the active time in it.
 *
 * KEEP IN SYNC with core/src/parse/extension.ts, which reads what toLog() writes.
 */

/** Must match the page script's beat interval (content-tracker.js). */
export const BEAT_MS = 10_000;
/** Three missed beats. Long enough to survive a busy page, short enough that a real pause splits the session. */
export const JOIN_GAP_MS = 30_000;
export const TOOLS = ["claude", "chatgpt"];

export function emptyState() {
  return { paused: false, open: {}, sessions: [] };
}

/** Where an open session effectively ends: its last real input plus one beat, never past its last beat. */
const endOf = (open) => Math.min(open.last, open.lastInput + BEAT_MS);

function closeOpen(state, tool) {
  const open = state.open[tool];
  if (!open) return;
  delete state.open[tool];
  const end = endOf(open);
  if (end > open.start) {
    const ref = `extension:${tool}:${open.start}`;
    state.sessions.push({
      id: ref,
      toolKey: tool,
      startedAt: open.start,
      endedAt: end,
      activeSeconds: (end - open.start) / 1000,
      messageCount: 0,
      externalRef: ref,
    });
  }
}

/**
 * Record one beat for `tool` at time `t` (ms). `idleMs` is how long before `t`
 * the user's last real input was. Mutates and returns `state`.
 */
export function addBeat(state, tool, t, idleMs = 0) {
  if (state.paused || !TOOLS.includes(tool) || !Number.isFinite(t)) return state;
  const input = t - (Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 0);
  const open = state.open[tool];
  if (open && t >= open.last && t - open.last <= JOIN_GAP_MS) {
    open.last = t;
    open.lastInput = Math.max(open.lastInput, input);
    return state;
  }
  // A long silence, or the clock moved backwards: close what we had and start fresh.
  closeOpen(state, tool);
  state.open[tool] = { start: t - BEAT_MS, last: t, lastInput: input };
  return state;
}

/** Close any open session that has been silent longer than the join gap as of `now`. */
export function settle(state, now) {
  for (const tool of Object.keys(state.open)) {
    if (now - state.open[tool].last > JOIN_GAP_MS) closeOpen(state, tool);
  }
  return state;
}

/** The log TrackHour imports. Only finished sessions: a session still in progress is not exported yet. */
export function toLog(state) {
  return { source: "trackhour-extension", version: 1, sessions: state.sessions.map((s) => ({ ...s })) };
}

/** Active seconds per tool since `sinceMs`, counting the session in progress too. For the popup. */
export function activeSecondsSince(state, sinceMs) {
  const out = { claude: 0, chatgpt: 0 };
  const add = (tool, start, end) => {
    const from = Math.max(start, sinceMs);
    if (end > from && tool in out) out[tool] += (end - from) / 1000;
  };
  for (const s of state.sessions) add(s.toolKey, s.startedAt, s.endedAt);
  for (const [tool, o] of Object.entries(state.open)) add(tool, o.start, endOf(o));
  return out;
}
