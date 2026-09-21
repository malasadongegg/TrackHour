/**
 * The Claude Code hook's timing logic, with no file or process access so it can
 * be unit tested (claude-code-hook/test/hook-core.test.mjs). hook.mjs does the
 * I/O and calls into this.
 *
 * WHY NOT "session start to session end": a terminal left open overnight would
 * count as a 12 hour session and be labeled Measured. Instead the hook records
 * ACTIVITY and a session is only the stretches around it:
 *   - "prompt": you sent a message (UserPromptSubmit)
 *   - "stop":   Claude finished replying (Stop)
 *   - "tool":   an edit tool ran (PostToolUse)
 *   - "start":  the session began or resumed (SessionStart)
 *
 * A stretch continues while events are close together. The allowed silence is
 * short between a finished reply and your next prompt (you walked away), and
 * long while Claude is mid-reply (a big task can run a long time with no events).
 * A longer silence closes the stretch; the next event opens a new one. Each
 * stretch becomes one Session whose length is its active time, so
 * endedAt - startedAt always equals activeSeconds (the web app relies on that).
 *
 * If the Stop and UserPromptSubmit hooks are not installed, only start and edit
 * events exist, so time is counted between those. Install all of them (see the
 * README) for accurate hours.
 */

/** Longest silence between a finished reply and your next prompt that still counts as the same stretch. */
export const IDLE_GAP_MS = 10 * 60_000;
/** Longest silence tolerated while Claude is mid-reply (long builds and test runs emit no events). */
export const WORKING_GAP_MS = 30 * 60_000;
/** Matches core/src/sessionize.ts DEFAULT_OPTIONS.minSessionMs, so a code session floors the same way an imported one does. */
export const MIN_SESSION_MS = 60_000;

const countLines = (s) => (typeof s === "string" && s.length > 0 ? s.split("\n").length : 0);

/** Lines touched by one Edit-style change: old lines removed plus new lines added. Not a real diff, close enough for a total. */
const editDelta = (oldStr, newStr) => countLines(oldStr) + countLines(newStr);

export function linesForToolCall(toolName, input) {
  if (!input || typeof input !== "object") return 0;
  switch (toolName) {
    case "Edit":
      return editDelta(input.old_string, input.new_string);
    case "Write":
      return countLines(input.content);
    case "MultiEdit":
      return Array.isArray(input.edits) ? input.edits.reduce((sum, e) => sum + editDelta(e?.old_string, e?.new_string), 0) : 0;
    case "NotebookEdit":
      return countLines(input.new_source);
    default:
      return 0;
  }
}

const openStretch = (t) => ({ start: t, last: t, calls: 0, lines: 0 });

export function newState(t) {
  return { v: 2, working: false, seg: openStretch(t), segments: [] };
}

/** Accepts a state file written by an older version of this hook (a bare start time and two counters). */
export function upgradeState(state, now) {
  if (state && state.v === 2 && Array.isArray(state.segments)) return state;
  const start = Number.isFinite(state?.startedAt) ? state.startedAt : now;
  return {
    v: 2,
    working: false,
    seg: { start, last: start, calls: Number(state?.toolCalls) || 0, lines: Number(state?.linesChanged) || 0 },
    segments: [],
  };
}

function closeStretch(state) {
  if (state.seg) state.segments.push(state.seg);
  state.seg = null;
}

/** Record one event at time `t` (ms). `lines` only matters for "tool". Mutates and returns `state`. */
export function record(state, kind, t, lines = 0) {
  if (!Number.isFinite(t)) return state;
  if (state.seg) {
    if (t < state.seg.last) t = state.seg.last; // a clock that moved backwards, or events written out of order
    const allowed = state.working ? WORKING_GAP_MS : IDLE_GAP_MS;
    if (t - state.seg.last > allowed) closeStretch(state);
  }
  if (!state.seg) state.seg = openStretch(t);
  state.seg.last = t;
  if (kind === "prompt") state.working = true;
  else if (kind === "stop") state.working = false;
  else if (kind === "tool") {
    state.seg.calls += 1;
    state.seg.lines += lines;
  }
  return state;
}

/**
 * Turn the recorded stretches into Sessions when the Claude Code session ends
 * at time `now`. A session that ends while Claude is still mid-reply (you quit
 * during it) runs to `now` if that is recent; otherwise it ends at the last
 * recorded activity, so time spent away is never counted.
 */
export function buildSessions(state, sessionId, now) {
  if (state.seg && state.working && now - state.seg.last <= WORKING_GAP_MS) state.seg.last = Math.max(state.seg.last, now);
  closeStretch(state);
  return state.segments.map((s, i) => {
    const durationMs = Math.max(MIN_SESSION_MS, s.last - s.start);
    const ref = `${sessionId}#${i}`;
    return {
      id: `claude_code:${ref}`,
      toolKey: "claude_code",
      startedAt: s.start,
      endedAt: s.start + durationMs,
      activeSeconds: durationMs / 1000,
      messageCount: s.calls,
      linesChanged: s.lines,
      source: "code_hook",
      confidence: "measured",
      importBatchId: null,
      externalRef: ref,
    };
  });
}

/** True if a log entry belongs to this Claude Code session (an older entry used the bare session id). */
export const belongsTo = (externalRef, sessionId) => externalRef === sessionId || (typeof externalRef === "string" && externalRef.startsWith(`${sessionId}#`));
