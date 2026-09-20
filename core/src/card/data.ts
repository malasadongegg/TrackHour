import { addDays, dayKey } from "../dates";
import { computeStats, dailyMinutes } from "../stats";
import { TOOL_KEYS, type ConversationRecord, type Session, type StatsContext, type ToolKey } from "../types";
import type { CardData, ProfileAggregates } from "./types";

/**
 * Computes everything a card needs for the chosen tools. The combined ("all")
 * stats cover exactly those tools, so a card showing only ChatGPT never mixes
 * in Claude hours. Tools with no sessions are left out of `byTool`.
 */
export function buildCardData(
  sessions: Session[],
  records: ConversationRecord[],
  ctx: StatsContext,
  tools: readonly ToolKey[] = TOOL_KEYS,
): CardData {
  const selected = TOOL_KEYS.filter((k) => tools.includes(k));
  const byTool: CardData["byTool"] = {};
  const daysByTool: CardData["daysByTool"] = {};
  for (const k of selected) {
    const toolSessions = sessions.filter((s) => s.toolKey === k);
    if (toolSessions.length === 0) continue;
    byTool[k] = computeStats(toolSessions, records, ctx, k);
    daysByTool[k] = dailyMinutes(toolSessions, ctx.timeZone);
  }
  const all = computeStats(
    sessions.filter((s) => selected.includes(s.toolKey)),
    records.filter((r) => selected.includes(r.toolKey)),
    ctx,
    "all",
  );
  return { timeZone: ctx.timeZone, generatedAt: ctx.now, all, byTool, daysByTool };
}

/** The heatmap on a card shows 30 weeks, so nothing older than this is ever sent to a server. */
export const AGGREGATE_DAYS = 30 * 7;

/**
 * The only thing that ever leaves the browser when a user saves a profile.
 * Per-tool stats (numbers and dates) and per-day active minutes for the recent
 * window the card can display. No message text, titles, or per-message
 * timestamps exist in CardData, and days older than the card window are dropped
 * (data minimization).
 */
export function toAggregates(data: CardData): ProfileAggregates {
  const cutoff = addDays(dayKey(data.generatedAt, data.timeZone), -AGGREGATE_DAYS);
  const daysByTool: ProfileAggregates["daysByTool"] = {};
  for (const k of TOOL_KEYS) {
    const days = data.daysByTool[k];
    if (days) daysByTool[k] = days.filter((d) => d.day >= cutoff).map((d) => ({ day: d.day, minutes: Math.round(d.minutes * 10) / 10 }));
  }
  return { timeZone: data.timeZone, updatedAt: data.generatedAt, all: data.all, byTool: data.byTool, daysByTool };
}
