import type { ImportBatch, Session } from "@trackhour/core";
import { fmtDate, fmtInt } from "../lib/format";
import { TOOL_META } from "../lib/tools";

interface Props {
  batches: ImportBatch[];
  totalConversations: number;
  sessions: Session[];
  timeZone: string;
  onDelete: (batch: ImportBatch) => void;
  onDeleteSessions: (toolKey: Session["toolKey"], source: Session["source"]) => void;
  onWipe: () => void;
}

const SOURCE_LABEL: Partial<Record<Session["source"], string>> = {
  code_hook: "measured by the Claude Code hook",
  import: "estimated from local Claude Code logs",
  extension: "measured by the browser extension",
};

/** Stored sessions grouped by tool and source, so each can be deleted on its own. */
function groupSessions(sessions: Session[]) {
  const groups = new Map<string, { toolKey: Session["toolKey"]; source: Session["source"]; count: number }>();
  for (const s of sessions) {
    const key = `${s.toolKey}|${s.source}`;
    const g = groups.get(key) ?? { toolKey: s.toolKey, source: s.source, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function DataManager({ batches, totalConversations, sessions, timeZone, onDelete, onDeleteSessions, onWipe }: Props) {
  const groups = groupSessions(sessions);
  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Stored in this browser only (IndexedDB): <span className="num text-ink">{fmtInt(totalConversations)}</span> conversations from{" "}
        <span className="num text-ink">{batches.length}</span> {batches.length === 1 ? "import" : "imports"}
        {sessions.length > 0 && (
          <>
            , and <span className="num text-ink">{fmtInt(sessions.length)}</span> tracked{" "}
            {sessions.length === 1 ? "session" : "sessions"}
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
        {groups.map((g) => (
          <li key={`${g.toolKey}|${g.source}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: TOOL_META[g.toolKey].color }} aria-hidden="true" />
                <span className="font-medium text-white">{TOOL_META[g.toolKey].label}</span>
                <span className="truncate text-muted">{SOURCE_LABEL[g.source] ?? "tracked sessions"}</span>
              </div>
              <div className="num mt-0.5 text-xs text-muted">
                {fmtInt(g.count)} {g.count === 1 ? "session" : "sessions"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDeleteSessions(g.toolKey, g.source)}
              className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:border-danger hover:text-danger"
            >
              Delete sessions
            </button>
          </li>
        ))}
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
