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
 */
import type { Session } from "../types";
import { isObj } from "./util";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface ParsedMeasuredSessions {
  sessions: Session[];
  skipped: number;
}

/** True if `json` looks like a Claude Code hook log, so the importer can route to this parser. */
export function isClaudeCodeLog(json: unknown): boolean {
  return isObj(json) && json.source === "trackhour-claude-code-hook" && Array.isArray(json.sessions);
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

export function parseClaudeCodeLog(json: unknown): ParsedMeasuredSessions {
  if (!isClaudeCodeLog(json)) return { sessions: [], skipped: 0 };
  const raw = (json as { sessions: unknown[] }).sessions;
  const sessions: Session[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (!isValidEntry(item)) {
      skipped++;
      continue;
    }
    // Normalized to exactly the Session shape: unknown extra fields in the log are dropped,
    // and confidence/source are always what this parser promises, regardless of what the file said.
    sessions.push({
      id: String(item.id ?? item.externalRef),
      toolKey: "claude_code",
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      activeSeconds: item.activeSeconds,
      messageCount: item.messageCount,
      linesChanged: item.linesChanged,
      source: "code_hook",
      confidence: "measured",
      importBatchId: null,
      externalRef: item.externalRef,
    });
  }
  return { sessions, skipped };
}
