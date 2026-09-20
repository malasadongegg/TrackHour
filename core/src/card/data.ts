import { computeStats, dailyMinutes } from "../stats";
import { TOOL_KEYS, type ConversationRecord, type Session, type StatsContext, type ToolKey } from "../types";
import type { CardData } from "./types";

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
