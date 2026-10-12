/**
 * Validates and normalizes the scanner's output file
 * (claude-code-hook/scan-usage.mjs, written as ~/.trackhour/claude-code-usage.json)
 * for import into the web app. Like every other import here, nothing in the
 * file is trusted: every field is re-checked and coerced to a safe default,
 * unknown extra fields are dropped, and a shape that is not even close to a
 * usage log returns null rather than throwing.
 *
 * Expected shape:
 *   { source: "trackhour-claude-code-usage", version: 1, stats: ClaudeCodeUsageStats }
 */
import type { ClaudeCodeUsageStats, DayUsage, ModelUsage } from "../claudeCodeUsage";
import { isObj, isPlausible } from "./util";

const SOURCE = "trackhour-claude-code-usage";
/** More than enough for any real log (13+ years of daily entries); a corrupted or hand-edited file cannot grow this unbounded. */
const MAX_DAYS = 5000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isClaudeCodeUsageLog(json: unknown): boolean {
  return isObj(json) && json.source === SOURCE && isObj(json.stats);
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const int = (v: unknown): number => Math.round(num(v));

function normalizeUsage(v: unknown): ModelUsage {
  const src = isObj(v) ? v : {};
  const inputTokens = num(src.inputTokens);
  const outputTokens = num(src.outputTokens);
  const cacheReadTokens = num(src.cacheReadTokens);
  const cacheCreationTokens = num(src.cacheCreationTokens);
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens };
}

/** Not a real model; never shown. Matches the aggregator's own filter, kept here too so a scan file written before this filter existed is still cleaned up on import. */
const SYNTHETIC_MODEL = "<synthetic>";

function normalizeByModel(v: unknown): Record<string, ModelUsage> {
  if (!isObj(v)) return {};
  const out: Record<string, ModelUsage> = {};
  for (const [model, usage] of Object.entries(v)) {
    if (typeof model !== "string" || model.length === 0 || model === SYNTHETIC_MODEL) continue;
    out[model] = normalizeUsage(usage);
  }
  return out;
}

function normalizeDay(v: unknown): DayUsage | null {
  if (!isObj(v) || typeof v.day !== "string" || !DAY_KEY.test(v.day)) return null;
  return { day: v.day, usage: normalizeUsage(v.usage), messages: int(v.messages), sessions: int(v.sessions) };
}

function normalizeByDay(v: unknown): DayUsage[] {
  if (!Array.isArray(v)) return [];
  const out: DayUsage[] = [];
  for (const item of v) {
    const d = normalizeDay(item);
    if (d) out.push(d);
    if (out.length >= MAX_DAYS) break;
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Epoch ms, or null. Rejects placeholder/implausible dates the same way the rest of the app does. */
function normalizeMoment(v: unknown, now: number): number | null {
  return typeof v === "number" && isPlausible(v, now) ? v : null;
}

/**
 * Parses and normalizes a stats log. Returns null only when the file is not
 * shaped like one at all (isClaudeCodeUsageLog is false); a usage-log-shaped
 * file with garbage inside it still normalizes to safe zeros rather than
 * failing, the same way normalizeCardConfig does for a card.
 */
export function parseClaudeCodeUsageLog(json: unknown, now = Date.now()): ClaudeCodeUsageStats | null {
  if (!isClaudeCodeUsageLog(json)) return null;
  const src = (json as { stats: unknown }).stats as Record<string, unknown>;
  return {
    usage: normalizeUsage(src.usage),
    byModel: normalizeByModel(src.byModel),
    byDay: normalizeByDay(src.byDay),
    messageCount: int(src.messageCount),
    sidechainMessages: int(src.sidechainMessages),
    sessionCount: int(src.sessionCount),
    activeDays: int(src.activeDays),
    firstActive: normalizeMoment(src.firstActive, now),
    lastActive: normalizeMoment(src.lastActive, now),
    generatedAt: typeof src.generatedAt === "number" && Number.isFinite(src.generatedAt) ? src.generatedAt : now,
  };
}
