import type { ToolStats } from "@trackhour/core";
import { fmtDate, fmtHours, fmtInt } from "../lib/format";
import { ConfidenceBadge } from "./Badge";

interface Props {
  name: string;
  color: string;
  stats: ToolStats;
  timeZone: string;
  wide?: boolean;
  note?: string;
}

/** Steam library style header card: name, hours on record, last used. */
export function ToolCard({ name, color, stats, timeZone, wide = false, note }: Props) {
  return (
    <section
      aria-label={`${name} summary`}
      className={`relative overflow-hidden rounded-lg border border-line bg-panel ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}
    >
      <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} aria-hidden="true" />
      <div className={`p-5 pl-7 ${wide ? "sm:flex sm:items-end sm:justify-between sm:gap-8" : ""}`}>
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">{name}</h3>
            <ConfidenceBadge confidence={stats.confidence} />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className={`num font-bold leading-none text-white ${wide ? "text-6xl" : "text-5xl"}`}>{fmtHours(stats.totalSeconds)}</span>
            <span className="text-sm text-muted">hrs on record</span>
          </div>
          <p className="mt-2 text-sm text-ink">
            last used <span className="num">{fmtDate(stats.lastUsed, timeZone)}</span>
          </p>
          {note && <p className="mt-1 text-xs text-muted">{note}</p>}
        </div>
        <dl className={`flex flex-wrap gap-x-8 gap-y-4 text-sm ${wide ? "mt-5 sm:mt-0 sm:min-w-[22rem]" : "mt-5"}`}>
          {(stats.conversationCount === 0 && stats.messages.total === 0 && stats.linesChanged > 0
            ? [
                ["Sessions", stats.sessionCount],
                ["Lines changed", stats.linesChanged],
              ]
            : [
                ["Sessions", stats.sessionCount],
                ["Conversations", stats.conversationCount],
                ["Messages", stats.messages.total],
              ]
          ).map(([label, value]) => (
            <div key={label}>
              <dd className="num text-lg font-semibold text-white">{fmtInt(value as number)}</dd>
              <dt className="text-xs text-muted">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
