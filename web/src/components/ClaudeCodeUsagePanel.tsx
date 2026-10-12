import type { ClaudeCodeUsageStats } from "@trackhour/core";
import { fmtDate, fmtInt, fmtTokens } from "../lib/format";

interface Props {
  stats: ClaudeCodeUsageStats;
  timeZone: string;
}

/**
 * A local scan of Claude Code's own transcripts (claude-code-hook/scan-usage.mjs),
 * shown on its own: tokens, not time, and not part of the hours-based tool cards
 * above it. Output tokens are the headline on purpose, never the raw total,
 * since cache reads are typically the large majority of total tokens.
 */
export function ClaudeCodeUsagePanel({ stats, timeZone }: Props) {
  const cachePct = stats.usage.totalTokens ? Math.round((stats.usage.cacheReadTokens / stats.usage.totalTokens) * 100) : 0;
  const models = Object.entries(stats.byModel).sort((a, b) => b[1].outputTokens - a[1].outputTokens);

  if (stats.messageCount === 0) {
    return (
      <section aria-label="Claude Code token usage" className="rounded-lg border border-line bg-panel p-5">
        <h3 className="text-sm font-semibold text-white">Claude Code, local scan</h3>
        <p className="mt-2 text-sm text-muted">No usage found in the scanned transcripts.</p>
      </section>
    );
  }

  return (
    <section aria-label="Claude Code token usage" className="space-y-4 rounded-lg border border-line bg-panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Claude Code, local scan</h3>
        <span className="text-xs text-muted">Scanned {fmtDate(stats.generatedAt, timeZone)}</span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="num text-4xl font-bold leading-none text-white">{fmtTokens(stats.usage.outputTokens)}</span>
        <span className="text-sm text-muted">output tokens</span>
      </div>
      <p className="num text-sm text-muted">
        {fmtTokens(stats.usage.totalTokens)} total tokens, {cachePct}% from cache reads
      </p>

      <dl className="grid grid-cols-3 gap-4 text-sm">
        {[
          ["Sessions", fmtInt(stats.sessionCount)],
          ["Messages", fmtInt(stats.messageCount)],
          ["Active days", fmtInt(stats.activeDays)],
        ].map(([label, value]) => (
          <div key={label}>
            <dd className="num text-lg font-semibold text-white">{value}</dd>
            <dt className="text-xs text-muted">{label}</dt>
          </div>
        ))}
      </dl>

      {stats.sidechainMessages > 0 && (
        <p className="text-xs text-muted">
          Includes <span className="num">{fmtInt(stats.sidechainMessages)}</span> sub-agent {stats.sidechainMessages === 1 ? "message" : "messages"}.
        </p>
      )}

      {models.length > 0 && (
        <div className="space-y-1.5 border-t border-line/60 pt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">By model</p>
          <ul className="space-y-1 text-sm">
            {models.map(([model, u]) => (
              <li key={model} className="flex items-center justify-between gap-3">
                <span className="truncate text-ink" title={model}>
                  {model}
                </span>
                <span className="num shrink-0 text-muted">{fmtTokens(u.outputTokens)} output</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">
        Read locally from Claude Code's own transcripts. Token totals, not time: not included in the hours above.
      </p>
    </section>
  );
}
