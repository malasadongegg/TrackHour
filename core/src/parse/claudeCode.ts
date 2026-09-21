/**
 * Parses the Claude Code hook's local session log into Session objects.
 *
 * Unlike the ChatGPT and Claude parsers, this is not turned into
 * ConversationRecords and run through sessionize(): the hook already measured
 * each session's real start and end time directly (SessionStart to
 * SessionEnd), so there is nothing left to estimate. These come out with
 * `confidence: "measured"` and `source: "code_hook"`, ready to use as
 * Sessions directly.
 *
 * Expected shape (written by claude-code-hook/hook.mjs):
 *   { source: "trackhour-claude-code-hook", version: 1, sessions: [...] }
 *
 * The same entry shape is also written by claude-code-hook/backfill.mjs, which
 * estimates PAST sessions from Claude Code's local transcripts, under
 *   { source: "trackhour-claude-code-backfill", ... }
 * Those are only estimates, so they come out `confidence: "estimated"`,
 * `source: "import"`. Which of the two a session is comes from this file-level
 * marker alone, never from anything an individual entry claims.
 */
import type { Session } from "../types";
import { isObj, isSaneSpan } from "./util";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface ParsedMeasuredSessions {
  sessions: Session[];
  skipped: number;
}

const HOOK_SOURCE = "trackhour-claude-code-hook";
const BACKFILL_SOURCE = "trackhour-claude-code-backfill";

/** True if `json` looks like a Claude Code hook or backfill log, so the importer can route to this parser. */
export function isClaudeCodeLog(json: unknown): boolean {
  return isObj(json) && (json.source === HOOK_SOURCE || json.source === BACKFILL_SOURCE) && Array.isArray(json.sessions);
}

function isValidEntry(v: unknown): v is Session {
  if (!isObj(v)) return false;
  return (
    v.toolKey === "claude_code" &&
    isFiniteNumber(v.startedAt) &&
    isFiniteNumber(v.endedAt) &&
    (v.endedAt as number) >= (v.startedAt as number) &&
    isFiniteNumber(v.activeSeconds) &&
    (v.activeSeconds as number) >= 0 &&
    isFiniteNumber(v.messageCount) &&
    typeof v.externalRef === "string" &&
    v.externalRef.length > 0 &&
    (v.linesChanged === undefined || isFiniteNumber(v.linesChanged))
  );
}

export function parseClaudeCodeLog(json: unknown, now = Date.now()): ParsedMeasuredSessions {
  if (!isClaudeCodeLog(json)) return { sessions: [], skipped: 0 };
  const raw = (json as { sessions: unknown[] }).sessions;
  const measured = (json as { source: string }).source === HOOK_SOURCE;
  const sessions: Session[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (!isValidEntry(item) || !isSaneSpan(item.startedAt, item.endedAt, now)) {
      skipped++;
      continue;
    }
    // Normalized to exactly the Session shape: unknown extra fields in the log are dropped,
    // and confidence/source come from the file-level marker, regardless of what an entry claimed.
    sessions.push({
      id: String(item.id ?? item.externalRef),
      toolKey: "claude_code",
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      // Recomputed from the times, never trusted from the file: totals and charts must agree.
      activeSeconds: (item.endedAt - item.startedAt) / 1000,
      messageCount: item.messageCount,
      linesChanged: item.linesChanged,
      source: measured ? "code_hook" : "import",
      confidence: measured ? "measured" : "estimated",
      importBatchId: null,
      externalRef: item.externalRef,
    });
  }
  return { sessions, skipped };
}
