/**
 * Aggregates Claude Code's own local transcript logs (~/.claude/projects/**\/*.jsonl)
 * into token and session usage stats. Pure: the file walk lives in
 * claude-code-hook/scan-usage.mjs, which turns each JSONL line into a RawTurn and
 * calls aggregateClaudeCodeUsage. This file never touches the filesystem.
 *
 * PRIVACY: sessionId is used only to help define session boundaries (see below)
 * and is never read back out. ClaudeCodeUsageStats, the only thing this returns,
 * carries no session id, message id, request id or uuid anywhere in its shape. A
 * test enforces that at the type level, not just by example.
 *
 * DEDUPE: one logical AI turn (one API response) can appear as several JSONL
 * lines when it has more than one content block (for example text, then a tool
 * call) — same message id, same token usage, different line. Measured directly
 * against a real log: of 4,415 repeated-id groups, 4,278 had byte-identical
 * output_tokens across every line, and the rest (a response saved incrementally
 * while streaming) had output_tokens rising monotonically, never falling or
 * disagreeing. So turns are grouped by `dedupeKey` (the API message id, or the
 * request id as a fallback) and only the one with the highest outputTokens in
 * each group is kept — correct whether the group is identical copies or a
 * growing stream, and deterministic regardless of input order.
 *
 * SESSIONS: a session is one continuous stretch of activity under ONE Claude
 * Code session id. A given id starts a new session whenever it has gone more
 * than `sessionGapMs` since IT was last active — tracked per id, not against
 * whichever turn happens to precede it in the global timeline. That distinction
 * matters: running two Claude Code sessions at once (two terminals, two
 * projects) interleaves their turns in the global timestamp order, and a rule
 * that only compared each turn to the one immediately before it would see the
 * session id "change" on every alternation and shred two real, continuous
 * sessions into dozens of one-message fragments. Measured directly against a
 * real log: two sessions overlapping for 51 minutes interleaved 46 times, which
 * the old global-comparison rule turned into 42 spurious one-to-three-message
 * sessions instead of the 2 real ones. Tracking the gap per id fixes that,
 * while still keeping the original reason an id matters at all: a brand new id
 * is always a new session (so two unrelated sessions started back to back are
 * never merged just because they're close in time), and an old id reused after
 * a long gap (a `--resume` days later) still counts as starting fresh.
 */
import { dayKey } from "./dates";
import { isPlausible } from "./parse/util";

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface DayUsage {
  /** "YYYY-MM-DD" in the time zone aggregateClaudeCodeUsage was called with. */
  day: string;
  usage: ModelUsage;
  messages: number;
  /** Sessions that touched this day (a session spanning midnight counts on both). */
  sessions: number;
}

/**
 * Everything aggregateClaudeCodeUsage returns. This is also exactly what the
 * scanner writes to disk and what the web app imports, so nothing here may ever
 * be a session id, message id, request id or uuid.
 */
export interface ClaudeCodeUsageStats {
  usage: ModelUsage;
  /** Keyed by the model's raw id (e.g. "claude-sonnet-5"), never a display label that can drift. */
  byModel: Record<string, ModelUsage>;
  byDay: DayUsage[];
  /** Deduped assistant turns counted. */
  messageCount: number;
  /** Subset of messageCount that were Task-tool sub-agent turns, counted separately rather than hidden inside the total. */
  sidechainMessages: number;
  sessionCount: number;
  activeDays: number;
  firstActive: number | null;
  lastActive: number | null;
  generatedAt: number;
}

/**
 * One assistant turn read from a transcript line, after the scanner has
 * stripped everything it does not need. INTERNAL ONLY: never serialized, never
 * part of ClaudeCodeUsageStats.
 */
export interface RawTurn {
  /** epoch ms */
  timestamp: number;
  /** Claude Code's own session id. Used only to bound sessions; see the module comment. */
  sessionId: string;
  /** message.id, or requestId as a fallback. Used only to dedupe; discarded after. */
  dedupeKey: string;
  model: string;
  isSidechain: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface AggregateOptions {
  /** A gap larger than this between two turns starts a new session. Default 15 minutes. */
  sessionGapMs?: number;
  timeZone?: string;
  now?: () => number;
}

const DEFAULT_SESSION_GAP_MS = 15 * 60_000;
const DEFAULT_TIME_ZONE = "UTC";
/** Claude Code's own placeholder for turns with no real model (e.g. synthesized continuations). Not a model, so it never appears in byModel. */
const SYNTHETIC_MODEL = "<synthetic>";

const emptyUsage = (): ModelUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0 });

/** A token count can never be negative or non-finite; bad input becomes 0 rather than corrupting every total downstream. */
const tok = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

function addUsage(into: ModelUsage, t: RawTurn): void {
  const i = tok(t.inputTokens);
  const o = tok(t.outputTokens);
  const cr = tok(t.cacheReadTokens);
  const cc = tok(t.cacheCreationTokens);
  into.inputTokens += i;
  into.outputTokens += o;
  into.cacheReadTokens += cr;
  into.cacheCreationTokens += cc;
  into.totalTokens += i + o + cr + cc;
}

/** Keeps the turn with the highest outputTokens per dedupeKey. A missing/empty key is never collapsed with another. */
function dedupe(turns: RawTurn[]): RawTurn[] {
  const byKey = new Map<string, RawTurn>();
  let synthetic = 0;
  for (const t of turns) {
    const key = t.dedupeKey || `#${synthetic++}`;
    const existing = byKey.get(key);
    if (!existing || tok(t.outputTokens) > tok(existing.outputTokens)) byKey.set(key, t);
  }
  return [...byKey.values()];
}

export function aggregateClaudeCodeUsage(turns: RawTurn[], opts: AggregateOptions = {}): ClaudeCodeUsageStats {
  const now = (opts.now ?? Date.now)();
  const sessionGapMs = opts.sessionGapMs && opts.sessionGapMs > 0 ? opts.sessionGapMs : DEFAULT_SESSION_GAP_MS;
  const timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE;

  const deduped = dedupe(turns)
    .filter((t) => isPlausible(t.timestamp, now))
    .sort((a, b) => a.timestamp - b.timestamp);

  const usage = emptyUsage();
  const byModel: Record<string, ModelUsage> = {};
  const dayUsage = new Map<string, { usage: ModelUsage; messages: number; sessionIndexes: Set<number> }>();
  let sidechainMessages = 0;
  let sessionIndex = -1;
  // Last-seen timestamp and assigned session, tracked PER session id (not a single "previous turn"
  // pointer), so that two different ids active around the same time never fragment each other. See
  // the SESSIONS section of the module comment for why this matters.
  const lastSeenBySessionId = new Map<string, { at: number; session: number }>();

  for (const t of deduped) {
    const seen = lastSeenBySessionId.get(t.sessionId);
    const session = !seen || t.timestamp - seen.at > sessionGapMs ? ++sessionIndex : seen.session;
    lastSeenBySessionId.set(t.sessionId, { at: t.timestamp, session });

    addUsage(usage, t);
    // Still counted in the overall usage, messageCount and sessions above: only excluded from the
    // per-model breakdown, where it is not a model and would just be confusing noise.
    const model = t.model || "unknown";
    if (model !== SYNTHETIC_MODEL) {
      byModel[model] ??= emptyUsage();
      addUsage(byModel[model], t);
    }
    if (t.isSidechain) sidechainMessages++;

    const day = dayKey(t.timestamp, timeZone);
    let d = dayUsage.get(day);
    if (!d) {
      d = { usage: emptyUsage(), messages: 0, sessionIndexes: new Set() };
      dayUsage.set(day, d);
    }
    addUsage(d.usage, t);
    d.messages++;
    d.sessionIndexes.add(session);
  }

  const byDay: DayUsage[] = [...dayUsage.entries()]
    .map(([day, d]) => ({ day, usage: d.usage, messages: d.messages, sessions: d.sessionIndexes.size }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  return {
    usage,
    byModel,
    byDay,
    messageCount: deduped.length,
    sidechainMessages,
    sessionCount: sessionIndex + 1,
    activeDays: byDay.length,
    firstActive: deduped.length ? deduped[0].timestamp : null,
    lastActive: deduped.length ? deduped[deduped.length - 1].timestamp : null,
    generatedAt: now,
  };
}
