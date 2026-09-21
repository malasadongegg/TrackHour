import type { ImportBatch } from "@trackhour/core";
import { fmtDate, fmtInt } from "../lib/format";
import { TOOL_META } from "../lib/tools";

interface Props {
  batches: ImportBatch[];
  totalConversations: number;
  measuredSessionCount: number;
  timeZone: string;
  onDelete: (batch: ImportBatch) => void;
  onDeleteMeasured: () => void;
  onWipe: () => void;
}

export function DataManager({ batches, totalConversations, measuredSessionCount, timeZone, onDelete, onDeleteMeasured, onWipe }: Props) {
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Stored in this browser only (IndexedDB): <span className="num text-ink">{fmtInt(totalConversations)}</span> conversations from{" "}
        <span className="num text-ink">{batches.length}</span> {batches.length === 1 ? "import" : "imports"}
        {measuredSessionCount > 0 && (
          <>
            , and <span className="num text-ink">{fmtInt(measuredSessionCount)}</span> measured Claude Code{" "}
            {measuredSessionCount === 1 ? "session" : "sessions"}
          </>
        )}
        . Nothing is sent anywhere.
      </p>
      <ul className="divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-panel">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TOOL_META[b.toolKey].color }} aria-hidden="true" />
                <span className="font-medium text-white">{TOOL_META[b.toolKey].label}</span>
                <span className="truncate text-muted">{b.fileName}</span>
              </div>
              <div className="num mt-0.5 text-xs text-muted">
                {fmtInt(b.conversationCount)} conversations, imported {fmtDate(b.importedAt, timeZone)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDelete(b)}
              className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:border-danger hover:text-danger"
            >
              Delete import
            </button>
          </li>
        ))}
        {measuredSessionCount > 0 && (
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TOOL_META.claude_code.color }} aria-hidden="true" />
                <span className="font-medium text-white">{TOOL_META.claude_code.label}</span>
                <span className="truncate text-muted">from the Claude Code hook</span>
              </div>
              <div className="num mt-0.5 text-xs text-muted">{fmtInt(measuredSessionCount)} measured sessions</div>
            </div>
            <button
              type="button"
              onClick={onDeleteMeasured}
              className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:border-danger hover:text-danger"
            >
              Delete sessions
            </button>
          </li>
        )}
      </ul>
      <div className="mt-4">
        <button
          type="button"
          onClick={onWipe}
          className="rounded border border-danger/50 px-3 py-1.5 text-sm text-danger hover:bg-danger/10"
        >
          Wipe everything
        </button>
      </div>
    </div>
  );
}
