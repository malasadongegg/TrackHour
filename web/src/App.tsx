import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CARD_CONFIG,
  TOOL_KEYS,
  buildPreview,
  computeStats,
  dailyMinutes,
  dayKey,
  dedupeRecords,
  monthlyHours,
  normalizeCardConfig,
  describeShape,
  parseExport,
  sessionize,
  type CardConfig,
  type ImportBatch,
  type ImportPreview as Preview,
  type ParsedExport,
  type SessionizeOptions,
  type ToolKey,
} from "@trackhour/core";
import { DataManager } from "./components/DataManager";
import { Dropzone } from "./components/Dropzone";
import { Heatmap } from "./components/Heatmap";
import { HowEstimated } from "./components/HowEstimated";
import { ImportPreview } from "./components/ImportPreview";
import { MonthlyBars } from "./components/MonthlyBars";
import { StatList } from "./components/StatList";
import { ToolCard } from "./components/ToolCard";
import { addImport, deleteBatch, loadLibrary, requestPersistence, saveCard, saveOptions, wipeAll, type Library } from "./lib/db";
import { fmtInt } from "./lib/format";
import { ALL_COLOR, TOOL_META } from "./lib/tools";
import { readExport } from "./lib/zip";
import { AccountPage } from "./pages/AccountPage";
import { CardPage } from "./pages/CardPage";
import { useAuth, type Auth } from "./lib/useAuth";

type View = ToolKey | "all";
type Page = "dashboard" | "card" | "account";

const PATHS: Record<Page, string> = { dashboard: "/", card: "/card", account: "/account" };
const pageFromPath = (): Page => {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === "/card" ? "card" : path === "/account" ? "account" : "dashboard";
};

interface Pending {
  fileName: string;
  parsed: ParsedExport;
  preview: Preview;
}

interface Report {
  toolKey: ToolKey;
  added: number;
  duplicates: number;
}

export function App() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("all");
  const auth = useAuth();
  const [page, setPageState] = useState<Page>(pageFromPath);
  const saveTimer = useRef<number | undefined>(undefined);

  // Real path routes ("/" and "/card"), so links work and the SPA rewrite on the host matters.
  const setPage = useCallback((next: Page) => {
    window.history.pushState(null, "", PATHS[next]);
    setPageState(next);
  }, []);
  useEffect(() => {
    const onPop = () => setPageState(pageFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.title = page === "card" ? "Card designer | TrackHour" : page === "account" ? "Account | TrackHour" : "TrackHour";
  }, [page]);

  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const reload = useCallback(async () => {
    try {
      setLibrary(await loadLibrary());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not open browser storage.");
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const records = library?.records;
  const options = library?.options;

  const derived = useMemo(() => {
    if (!records || !options) return null;
    const now = Date.now();
    const ctx = { now, timeZone };
    const sessions = TOOL_KEYS.flatMap((k) => sessionize(records, k, options));
    const toolsWithData = TOOL_KEYS.filter((k) => records.some((r) => r.toolKey === k));
    const stats = {
      all: computeStats(sessions, records, ctx, "all"),
      chatgpt: computeStats(sessions, records, ctx, "chatgpt"),
      claude: computeStats(sessions, records, ctx, "claude"),
      claude_code: computeStats(sessions, records, ctx, "claude_code"),
    };
    return { sessions, toolsWithData, stats, now, today: dayKey(now, timeZone) };
  }, [records, options, timeZone]);

  const activeView: View = derived && (view === "all" || derived.toolsWithData.includes(view)) ? view : "all";
  const viewSessions = useMemo(
    () => (derived ? (activeView === "all" ? derived.sessions : derived.sessions.filter((s) => s.toolKey === activeView)) : []),
    [derived, activeView],
  );
  const days = useMemo(() => dailyMinutes(viewSessions, timeZone), [viewSessions, timeZone]);
  const months = useMemo(() => monthlyHours(viewSessions, timeZone), [viewSessions, timeZone]);

  async function handleFile(file: File) {
    if (!library) return;
    setError(null);
    setReport(null);
    setBusy(true);
    try {
      const json = await readExport(file);
      const batchId = crypto.randomUUID();
      const parsed = parseExport(json, batchId);
      if (!parsed) {
        throw new Error(
          `This does not look like a ChatGPT or Claude conversations file. It is ${describeShape(json)}. ` +
            "I look for conversations that contain a mapping (ChatGPT) or chat_messages (Claude) field. " +
            "If your export has several files, use conversations.json.",
        );
      }
      if (parsed.records.length === 0) throw new Error("No usable conversations were found in this export.");
      const preview = buildPreview(parsed.toolKey, library.records, parsed.records, parsed.skipped, library.options);
      setPending({ fileName: file.name, parsed, preview });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!pending || !library) return;
    setBusy(true);
    try {
      const { fresh, duplicates } = dedupeRecords(library.records, pending.parsed.records);
      const batch: ImportBatch = {
        id: pending.parsed.records[0].importBatchId,
        toolKey: pending.parsed.toolKey,
        fileName: pending.fileName,
        importedAt: Date.now(),
        conversationCount: fresh.length,
      };
      const added = await addImport(batch, fresh);
      void requestPersistence();
      await reload();
      setReport({ toolKey: pending.parsed.toolKey, added, duplicates: duplicates.length });
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function changeOptions(next: SessionizeOptions) {
    setLibrary((lib) => (lib ? { ...lib, options: next } : lib));
    await saveOptions(next);
  }

  /** Card edits apply instantly and are saved a moment after the last change. */
  function changeCard(patch: Partial<CardConfig>) {
    if (!library) return;
    const next = normalizeCardConfig({ ...library.card, ...patch });
    setLibrary({ ...library, card: next });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveCard(next).catch(() => undefined), 300);
  }

  function resetCard() {
    if (!library) return;
    setLibrary({ ...library, card: DEFAULT_CARD_CONFIG });
    window.clearTimeout(saveTimer.current);
    void saveCard(DEFAULT_CARD_CONFIG).catch(() => undefined);
  }

  async function removeBatch(batch: ImportBatch) {
    if (!window.confirm(`Delete this ${TOOL_META[batch.toolKey].label} import (${batch.fileName})? Its ${fmtInt(batch.conversationCount)} conversations will be removed from this browser.`)) return;
    await deleteBatch(batch.id);
    setReport(null);
    await reload();
  }

  async function wipe() {
    if (!window.confirm("Delete ALL imported data from this browser? This cannot be undone. You can import your exports again.")) return;
    await wipeAll();
    setReport(null);
    setView("all");
    setPage("dashboard");
    await reload();
  }

  if (loadError) {
    return (
      <Shell>
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger">
          Browser storage is unavailable, so imports cannot be saved. {loadError}
        </p>
      </Shell>
    );
  }
  if (!library || !derived) {
    return (
      <Shell>
        <p className="text-sm text-muted">Loading...</p>
      </Shell>
    );
  }

  const hasData = library.records.length > 0;
  const viewColor = activeView === "all" ? ALL_COLOR : TOOL_META[activeView].color;
  const viewLabel = activeView === "all" ? "All tools" : TOOL_META[activeView].label;

  return (
    <Shell nav={hasData ? <Tabs page={page} onChange={setPage} auth={auth} /> : null}>
      {report && (
        <Banner tone="ok" onClose={() => setReport(null)}>
          Imported <strong>{fmtInt(report.added)}</strong> new {TOOL_META[report.toolKey].label} conversations.{" "}
          {report.duplicates > 0
            ? `Skipped ${fmtInt(report.duplicates)} already imported ${report.duplicates === 1 ? "duplicate" : "duplicates"}.`
            : "No duplicates were skipped."}
        </Banner>
      )}
      {error && (
        <Banner tone="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {!hasData ? (
        <div className="py-10">
          <Dropzone onFile={handleFile} busy={busy} />
        </div>
      ) : page === "account" ? (
        <AccountPage auth={auth} sessions={derived.sessions} records={library.records} now={derived.now} timeZone={timeZone} card={library.card} />
      ) : page === "card" ? (
        <CardPage
          sessions={derived.sessions}
          records={library.records}
          now={derived.now}
          timeZone={timeZone}
          toolsWithData={derived.toolsWithData}
          config={library.card}
          onChange={changeCard}
          onReset={resetCard}
        />
      ) : (
        <div className="space-y-10">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ToolCard
              wide
              name="All tools"
              color={ALL_COLOR}
              stats={derived.stats.all}
              timeZone={timeZone}
              note="Sum of the tool totals. Time in two tools at once counts twice."
            />
            {derived.toolsWithData.map((k) => (
              <ToolCard key={k} name={TOOL_META[k].label} color={TOOL_META[k].color} stats={derived.stats[k]} timeZone={timeZone} />
            ))}
          </div>

          <Dropzone onFile={handleFile} busy={busy} compact />

          <section className="space-y-6" aria-label="Usage detail">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Activity</h2>
              <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-1" role="group" aria-label="Choose tool">
                {(["all", ...derived.toolsWithData] as View[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={activeView === v}
                    onClick={() => setView(v)}
                    className={`rounded px-3 py-1 text-sm ${activeView === v ? "bg-raised text-white" : "text-muted hover:text-ink"}`}
                  >
                    {v === "all" ? "All" : TOOL_META[v].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-line bg-panel p-5">
              <Heatmap days={days} color={viewColor} today={derived.today} />
            </div>
            <div className="rounded-lg border border-line bg-panel p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Monthly usage, {viewLabel}</h3>
              <MonthlyBars months={months} color={viewColor} />
            </div>
          </section>

          <section aria-label="Stats" className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Stats, {viewLabel}</h2>
            <StatList stats={derived.stats[activeView]} timeZone={timeZone} />
          </section>

          <HowEstimated options={library.options} onChange={changeOptions} />

          <section aria-label="Data management" className="space-y-3">
            <h2 className="text-lg font-semibold text-white">Your data</h2>
            <DataManager
              batches={library.batches}
              totalConversations={library.records.length}
              timeZone={timeZone}
              onDelete={removeBatch}
              onWipe={wipe}
            />
          </section>
        </div>
      )}

      {pending && (
        <ImportPreview
          fileName={pending.fileName}
          preview={pending.preview}
          timeZone={timeZone}
          busy={busy}
          onConfirm={commitImport}
          onCancel={() => setPending(null)}
        />
      )}
    </Shell>
  );
}

function Tabs({ page, onChange, auth }: { page: Page; onChange: (p: Page) => void; auth: Auth }) {
  const tabs: Array<[Page, string]> = [
    ["dashboard", "Dashboard"],
    ["card", "Card"],
    ...(auth.configured ? ([["account", "Account"]] as Array<[Page, string]>) : []),
  ];
  return (
    <nav aria-label="Pages" className="flex gap-1 rounded-lg border border-line bg-panel p-1">
      {tabs.map(([key, label]) => (
        <a
          key={key}
          href={PATHS[key]}
          aria-current={page === key ? "page" : undefined}
          onClick={(e) => {
            // Let modified clicks (new tab) behave normally, handle plain clicks in-app.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onChange(key);
          }}
          className={`rounded px-4 py-1.5 text-sm ${page === key ? "bg-raised text-white" : "text-muted hover:text-ink"}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function Shell({ children, nav }: { children: React.ReactNode; nav?: React.ReactNode }) {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 pb-20 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-6">
        <div className="flex items-center gap-3">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="6" fill="#172231" stroke="#2a3f55" />
            <path d="M16 7v9l6 3" stroke="#66c0f4" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
          <h1 className="text-lg font-bold tracking-wide text-white">TrackHour</h1>
        </div>
        {nav}
        <span className="hidden text-xs text-muted lg:block">Your chats never leave your device.</span>
      </header>
      <main className="space-y-6">{children}</main>
    </div>
  );
}

function Banner({ tone, onClose, children }: { tone: "ok" | "error"; onClose: () => void; children: React.ReactNode }) {
  const styles = tone === "ok" ? "border-accent/40 bg-accent/10 text-ink" : "border-danger/40 bg-danger/10 text-danger";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <p>{children}</p>
      <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Dismiss">
        Close
      </button>
    </div>
  );
}
