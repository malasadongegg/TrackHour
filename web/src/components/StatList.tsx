import type { ToolStats } from "@trackhour/core";
import { fmtDate, fmtDuration, fmtHours, fmtInt, fmtMonth, WEEKDAYS } from "../lib/format";
import { ConfidenceBadge } from "./Badge";

interface Props {
  stats: ToolStats;
  timeZone: string;
}

const CAPTION: Record<ToolStats["confidence"], string> = {
  estimated: "Durations are estimates. Weeks start on Monday.",
  measured: "Durations are measured directly. Weeks start on Monday.",
  mixed: "Some durations are measured, some are estimated. They are never blended for the same day. Weeks start on Monday.",
  manual: "Durations were entered by hand. Weeks start on Monday.",
};

export function StatList({ stats: s, timeZone }: Props) {
  const days = (n: number) => `${fmtInt(n)} ${n === 1 ? "day" : "days"}`;
  const rows: Array<[string, string]> = [
    ["First used", fmtDate(s.firstUsed, timeZone)],
    ["Last used", fmtDate(s.lastUsed, timeZone)],
    ["Days since first use", s.daysSinceFirstUse === null ? "None" : fmtInt(s.daysSinceFirstUse)],
    ["Total hours", `${fmtHours(s.totalSeconds)} hrs`],
    ["Sessions", fmtInt(s.sessionCount)],
    ["Conversations", fmtInt(s.conversationCount)],
    ["Messages", `${fmtInt(s.messages.total)}`],
    ["Your messages", fmtInt(s.messages.user)],
    ["Assistant messages", fmtInt(s.messages.assistant)],
    ...(s.linesChanged > 0 ? ([["Lines changed", fmtInt(s.linesChanged)]] as Array<[string, string]>) : []),
    ["Average session", s.sessionCount ? fmtDuration(s.avgSessionSeconds) : "None"],
    ["Longest session", s.sessionCount ? fmtDuration(s.longestSessionSeconds) : "None"],
    ["Current streak", days(s.currentStreak)],
    ["Longest streak", days(s.longestStreak)],
    ["Most active weekday", s.mostActiveWeekday === null ? "None" : WEEKDAYS[s.mostActiveWeekday]],
    ["Most active month", s.mostActiveMonth === null ? "None" : fmtMonth(s.mostActiveMonth)],
    ["Today", fmtDuration(s.usage.today)],
    ["This week", fmtDuration(s.usage.week)],
    ["This month", fmtDuration(s.usage.month)],
    ["This year", fmtDuration(s.usage.year)],
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <ConfidenceBadge confidence={s.confidence} />
        <span>{CAPTION[s.confidence]}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
      <dl className="-mb-px -mr-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="border-b border-r border-line px-4 py-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="num mt-0.5 text-base font-semibold text-white">{value}</dd>
          </div>
        ))}
      </dl>
      </div>
    </div>
  );
}
