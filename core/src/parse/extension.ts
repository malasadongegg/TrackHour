/**
 * Parses the browser extension's session log into Session objects.
 *
 * The extension measures real active time on claude.ai and chatgpt.com, so
 * these are not estimated from message times: they come out with
 * `confidence: "measured"` and `source: "extension"`, ready to use directly.
 * The extension never reads message text, so a session carries no message count.
 *
 * Expected shape (built by extension/src/sessions.js):
 *   { source: "trackhour-extension", version: 1, sessions: [...] }
 *
 * Nothing in an entry is trusted beyond its numbers: tool must be chatgpt or
 * claude, times must be sane, and activeSeconds is recomputed from the times so
 * that endedAt - startedAt always equals it (day bucketing relies on that).
 */
import type { Session, ToolKey } from "../types";
import type { ParsedMeasuredSessions } from "./claudeCode";
import { isObj } from "./util";

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const EXTENSION_TOOLS: readonly ToolKey[] = ["chatgpt", "claude"];
/** A single extension session longer than this is not credible (a runaway tab); it is skipped rather than counted. */
const MAX_SESSION_MS = 24 * 3_600_000;

/** True if `json` looks like the extension's log, so the importer can route to this parser. */
export function isExtensionLog(json: unknown): boolean {
  return isObj(json) && json.source === "trackhour-extension" && Array.isArray(json.sessions);
}

export function parseExtensionLog(json: unknown): ParsedMeasuredSessions {
  if (!isExtensionLog(json)) return { sessions: [], skipped: 0 };
  const raw = (json as { sessions: unknown[] }).sessions;
  const sessions: Session[] = [];
  let skipped = 0;
  for (const item of raw) {
    if (
      !isObj(item) ||
      !EXTENSION_TOOLS.includes(item.toolKey as ToolKey) ||
      !isFiniteNumber(item.startedAt) ||
      !isFiniteNumber(item.endedAt) ||
      item.endedAt <= item.startedAt ||
      item.endedAt - item.startedAt > MAX_SESSION_MS ||
      typeof item.externalRef !== "string" ||
      item.externalRef.length === 0
    ) {
      skipped++;
      continue;
    }
    sessions.push({
      id: item.externalRef,
      toolKey: item.toolKey as ToolKey,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      activeSeconds: (item.endedAt - item.startedAt) / 1000,
      messageCount: 0,
      source: "extension",
      confidence: "measured",
      importBatchId: null,
      externalRef: item.externalRef,
    });
  }
  return { sessions, skipped };
}
