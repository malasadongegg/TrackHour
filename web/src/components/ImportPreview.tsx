import type { ImportPreview as Preview } from "@trackhour/core";
import { fmtDate, fmtDuration, fmtHours, fmtInt } from "../lib/format";
import { TOOL_META } from "../lib/tools";
import { EstimatedBadge } from "./Badge";

interface Props {
  fileName: string;
  preview: Preview;
  timeZone: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ImportPreview({ fileName, preview: p, timeZone, busy, onConfirm, onCancel }: Props) {
  const meta = TOOL_META[p.toolKey];
  const nothingNew = p.newConversations === 0;

  const rows: Array<[string, string]> = [
    ["Provider", meta.label],
    ["Earliest activity", fmtDate(p.earliest, timeZone)],
    ["Latest activity", fmtDate(p.latest, timeZone)],
    ["Conversations", `${fmtInt(p.newConversations)} new of ${fmtInt(p.conversationsInFile)} in file`],
    ["Already imported", `${fmtInt(p.duplicateConversations)} will be skipped`],
    ["Messages", `${fmtInt(p.messages.total)} (${fmtInt(p.messages.user)} yours, ${fmtInt(p.messages.assistant)} replies)`],
    ["Estimated sessions", fmtInt(p.estimatedSessions)],
    ["Estimated usage", `${fmtHours(p.estimatedSeconds)} hrs (${fmtDuration(p.estimatedSeconds)})`],
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="preview-title">
      <div className="w-full max-w-lg rounded-xl border border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="preview-title" className="text-lg font-semibold text-white">
              Import preview
            </h2>
            <p className="mt-0.5 break-all text-xs text-muted">{fileName}</p>
          </div>
          <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: meta.color }} aria-hidden="true" />
        </div>

        <dl className="mt-5 divide-y divide-line/60 rounded-lg border border-line bg-bg/50">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-4 py-2 text-sm">
              <dt className="text-muted">{label}</dt>
              <dd className="num text-right text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex items-center gap-2 text-sm text-ink">
          <EstimatedBadge />
          <span>Confidence: estimated from message timestamps</span>
        </div>
        {p.skippedConversations > 0 && (
          <p className="mt-2 text-xs text-muted">{fmtInt(p.skippedConversations)} empty or unreadable conversations in the file were ignored.</p>
        )}
        {nothingNew && <p className="mt-3 text-sm text-warn">Nothing new here. Every conversation in this file is already imported.</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded border border-line px-4 py-2 text-sm text-ink hover:border-accent">
            {nothingNew ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || nothingNew}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
