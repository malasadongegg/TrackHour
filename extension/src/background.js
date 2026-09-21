/**
 * Service worker. Owns all stored data and the only writes to it.
 *
 * Everything lives in chrome.storage.local on this machine. There is no
 * network code anywhere in this extension.
 *
 * The clock used for beats is this worker's own, not one sent by a page, so a
 * page cannot back-date or invent time.
 */
import { activeSecondsSince, addBeat, emptyState, settle, toLog } from "./sessions.js";

const KEY = "trackhour";

// Two tabs can beat at the same moment, and every handler reads then writes
// the whole state, so run them one at a time.
let queue = Promise.resolve();
function withState(fn) {
  const run = queue.then(async () => {
    const stored = (await chrome.storage.local.get(KEY))[KEY];
    const state = stored && typeof stored === "object" ? { ...emptyState(), ...stored } : emptyState();
    const result = await fn(state);
    await chrome.storage.local.set({ [KEY]: state });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const handlers = {
  beat: (state, msg) => {
    // idleMs comes from the page; it only ever shortens a session, and is bounded so junk cannot matter.
    addBeat(state, msg.tool, Date.now(), Math.min(Math.max(Number(msg.idleMs) || 0, 0), 600_000));
  },
  "get-log": (state) => toLog(settle(state, Date.now())),
  status: (state) => {
    settle(state, Date.now());
    return {
      paused: state.paused,
      sessionCount: state.sessions.length,
      today: activeSecondsSince(state, startOfToday()),
      all: activeSecondsSince(state, 0),
    };
  },
  "set-paused": (state, msg) => {
    state.paused = Boolean(msg.paused);
    settle(state, Date.now());
  },
  clear: (state) => {
    const fresh = emptyState();
    fresh.paused = state.paused;
    state.open = fresh.open;
    state.sessions = fresh.sessions;
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg && typeof msg.type === "string" ? handlers[msg.type] : undefined;
  if (!handler) return false;
  withState((state) => handler(state, msg)).then(
    (result) => sendResponse({ ok: true, result }),
    () => sendResponse({ ok: false }),
  );
  return true; // keep the channel open for the async response
});
