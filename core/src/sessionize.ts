/**
 * SESSION ESTIMATION
 * ==================
 * An export tells us WHEN each message was sent. It does not tell us how long
 * anyone was actually looking at the screen. So we estimate, and every result
 * is labeled confidence "estimated". The algorithm:
 *
 *  1. Per tool, gather every activity timestamp from every stored conversation
 *     and sort them ascending. Timestamps from different conversations are
 *     MERGED: two chats open in parallel are one stretch of use, not two.
 *
 *  2. Walk the sorted list. Whenever the gap between two consecutive
 *     timestamps EXCEEDS the inactivity threshold (default 15 minutes), a new
 *     session starts. A gap of exactly the threshold does not split.
 *
 *  3. A session's duration is (last timestamp - first timestamp).
 *
 *  4. A session with one timestamp, or a very short span, would count as zero
 *     or near zero even though real use happened. So each session is floored to
 *     a minimum duration (default 1 minute).
 *
 *  5. The estimated total for a tool is the sum of its session durations.
 *
 * Known biases (also surfaced in the UI):
 *  - Time spent reading the LAST reply is not counted, because no later
 *    timestamp marks when you stopped. This under-counts.
 *  - Long pauses inside one 15 minute window count as active. This over-counts.
 *  - Time spent in a tool without sending a message is invisible.
 *
 * Sessions are derived, never stored. That keeps the threshold configurable
 * after import and makes "delete an import" exact: remove its conversations
 * and re-derive.
 */

import { dayKey, nextDayStart } from "./dates";
import type { ConversationRecord, Session, SessionizeOptions, ToolKey } from "./types";

export const DEFAULT_OPTIONS: SessionizeOptions = {
  inactivityGapMs: 15 * 60_000,
  minSessionMs: 60_000,
};

export function resolveOptions(opts?: Partial<SessionizeOptions>): SessionizeOptions {
  const gap = opts?.inactivityGapMs;
  const min = opts?.minSessionMs;
  return {
    inactivityGapMs: gap !== undefined && Number.isFinite(gap) && gap > 0 ? gap : DEFAULT_OPTIONS.inactivityGapMs,
    minSessionMs: min !== undefined && Number.isFinite(min) && min >= 0 ? min : DEFAULT_OPTIONS.minSessionMs,
  };
}

function collect(records: ConversationRecord[], toolKey: ToolKey, field: "activityTimes" | "messageTimes"): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.toolKey !== toolKey) continue;
    for (const t of r[field]) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Derive estimated sessions for one tool from its stored conversations.
 * Pure: the same records and options always yield the same sessions.
 */
export function sessionize(
  records: ConversationRecord[],
  toolKey: ToolKey,
  opts?: Partial<SessionizeOptions>,
): Session[] {
  const { inactivityGapMs, minSessionMs } = resolveOptions(opts);
  const times = collect(records, toolKey, "activityTimes");
  if (times.length === 0) return [];
  const messageTimes = collect(records, toolKey, "messageTimes");

  // Step 1 and 2: split the sorted timestamps on gaps larger than the threshold.
  const spans: Array<[first: number, last: number]> = [];
  let first = times[0];
  let last = times[0];
  for (let i = 1; i < times.length; i++) {
    const t = times[i];
    if (t - last > inactivityGapMs) {
      spans.push([first, last]);
      first = t;
    }
    last = t;
  }
  spans.push([first, last]);

  // Step 3 and 4: measure each span and apply the minimum floor. Message
  // counts are attributed with a moving pointer since spans are disjoint and
  // both lists are sorted.
  const sessions: Session[] = [];
  let m = 0;
  for (const [start, end] of spans) {
    while (m < messageTimes.length && messageTimes[m] < start) m++;
    let count = 0;
    while (m < messageTimes.length && messageTimes[m] <= end) {
      count++;
      m++;
    }
    const durationMs = Math.max(end - start, minSessionMs);
    const ref = `${toolKey}:${start}`;
    sessions.push({
      id: ref,
      toolKey,
      startedAt: start,
      // endedAt is start + floored duration so that endedAt - startedAt always
      // equals activeSeconds. Day bucketing relies on that.
      endedAt: start + durationMs,
      activeSeconds: durationMs / 1000,
      messageCount: count,
      source: "import",
      confidence: "estimated",
      importBatchId: null,
      externalRef: ref,
    });
  }
  return sessions;
}

/**
 * COMBINING ESTIMATED AND MEASURED SESSIONS
 * ==========================================
 * Once a tool has a source of MEASURED time for a given tool (the Claude Code
 * hook, or later the browser extension), that source is trusted over an
 * estimate for any day it actually covers. Concretely: for each local day a
 * measured session touches, every ESTIMATED session for that same tool that
 * starts on that day is dropped, and the measured sessions stand in its place.
 * Days a measured source has never reported (including all of history before
 * it started running) keep their estimated sessions untouched, so a fresh
 * install of the hook does not erase your imported past.
 */
export function combineSessions(estimated: Session[], measured: Session[], timeZone: string): Session[] {
  const coveredDaysByTool = new Map<ToolKey, Set<string>>();
  for (const s of measured) {
    const days = coveredDaysByTool.get(s.toolKey) ?? new Set<string>();
    let cursor = s.startedAt;
    while (cursor < s.endedAt) {
      days.add(dayKey(cursor, timeZone));
      cursor = Math.min(s.endedAt, nextDayStart(cursor, timeZone));
    }
    coveredDaysByTool.set(s.toolKey, days);
  }
  const kept = estimated.filter((s) => !coveredDaysByTool.get(s.toolKey)?.has(dayKey(s.startedAt, timeZone)));
  return [...kept, ...measured];
}
