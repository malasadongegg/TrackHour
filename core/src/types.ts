/**
 * Shared types. Forward-compatible with the future Supabase schema.
 *
 * Conventions:
 *  - Every timestamp in core is epoch MILLISECONDS (a plain number). Convert to
 *    timestamptz at the Supabase boundary, not here.
 *  - "Day" strings are "YYYY-MM-DD" in a caller-supplied IANA time zone.
 */

export const TOOL_KEYS = ["chatgpt", "claude", "claude_code"] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];

export type Source = "import" | "extension" | "code_hook" | "manual";

/**
 * How trustworthy a duration is.
 *  - estimated: inferred from message timestamps (every import)
 *  - measured:  observed directly (extension active time, code hook)
 *  - manual:    typed in by the user
 */
export type Confidence = "estimated" | "measured" | "manual";

/**
 * A usage session. Matches the future Supabase `sessions` row.
 *
 * In phase 1 sessions are DERIVED at read time by `sessionize()` from stored
 * ConversationRecords, never persisted. Because one session can span several
 * conversations (and several import batches), derived sessions carry
 * `importBatchId: null` and a deterministic `externalRef` of
 * `${toolKey}:${startedAt}`, which makes a later Supabase upsert idempotent.
 */
export interface Session {
  id: string;
  toolKey: ToolKey;
  startedAt: number;
  endedAt: number;
  /** Duration after the minimum-session floor, in seconds. */
  activeSeconds: number;
  messageCount: number;
  linesChanged?: number;
  source: Source;
  confidence: Confidence;
  importBatchId: string | null;
  externalRef: string;
}

/**
 * What the importer stores: one per conversation. This is the unit of dedup,
 * keyed by (toolKey, externalRef).
 *
 * PRIVACY: this type is the whole privacy boundary. Parsers extract only
 * timestamps and counts from an export. No message text and no conversation
 * title is ever copied into a record, so nothing here can leak content. Do not
 * add a text field. A test enforces it.
 */
export interface ConversationRecord {
  toolKey: ToolKey;
  /** ChatGPT id / conversation_id, Claude uuid. */
  externalRef: string;
  createdAt: number | null;
  updatedAt: number | null;
  /**
   * Sorted ascending. Every node or message that carried a real timestamp.
   * Feeds sessionization. A superset of `messageTimes`.
   */
  activityTimes: number[];
  /**
   * Sorted ascending. Timestamps of the messages that count toward
   * `userMessages` / `assistantMessages` (subset of `activityTimes`). Used to
   * attribute a message count to each derived session.
   */
  messageTimes: number[];
  /** Counted messages, regardless of whether they had a timestamp. */
  userMessages: number;
  assistantMessages: number;
  importBatchId: string;
}

export interface ImportBatch {
  id: string;
  toolKey: ToolKey;
  fileName: string;
  importedAt: number;
  /** Conversations this batch currently owns (new ones, and ones it updated). */
  conversationCount: number;
}

export interface SessionizeOptions {
  /** A gap larger than this between two timestamps starts a new session. */
  inactivityGapMs: number;
  /** Sessions shorter than this are floored to it, so they never count as zero. */
  minSessionMs: number;
}

export interface MessageCounts {
  user: number;
  assistant: number;
  total: number;
}

export interface ParseResult {
  records: ConversationRecord[];
  /** Conversations that were malformed or completely empty and were ignored. */
  skipped: number;
}

export interface ParsedExport extends ParseResult {
  toolKey: ToolKey;
}

/**
 * Describes what committing an import WOULD add. Everything except the
 * conversation counts is computed over the NEW and UPDATED conversations only,
 * so the numbers match what will actually be written.
 */
export interface ImportPreview {
  toolKey: ToolKey;
  conversationsInFile: number;
  newConversations: number;
  /** Already stored, but this file has more messages, so the stored copy is replaced. */
  updatedConversations: number;
  /** Already stored with nothing new. Skipped. */
  unchangedConversations: number;
  skippedConversations: number;
  earliest: number | null;
  latest: number | null;
  messages: MessageCounts;
  estimatedSessions: number;
  estimatedSeconds: number;
}

export interface StatsContext {
  /** "Current time" in epoch ms. Injected so stats stay pure and testable. */
  now: number;
  /** IANA zone used for day bucketing, e.g. "Asia/Manila" or "UTC". */
  timeZone: string;
}

export interface DayBucket {
  /** "YYYY-MM-DD" */
  day: string;
  minutes: number;
}

export interface MonthBucket {
  /** "YYYY-MM" */
  month: string;
  hours: number;
}

export interface ToolStats {
  toolKey: ToolKey | "all";
  firstUsed: number | null;
  lastUsed: number | null;
  daysSinceFirstUse: number | null;
  totalSeconds: number;
  sessionCount: number;
  conversationCount: number;
  messages: MessageCounts;
  avgSessionSeconds: number;
  longestSessionSeconds: number;
  currentStreak: number;
  longestStreak: number;
  /** 0 = Sunday ... 6 = Saturday. */
  mostActiveWeekday: number | null;
  /** "YYYY-MM" */
  mostActiveMonth: string | null;
  /** Seconds. Week is the calendar week starting Monday. */
  usage: { today: number; week: number; month: number; year: number };
  /** "mixed" if the underlying sessions have more than one confidence level. */
  confidence: Confidence | "mixed";
}
