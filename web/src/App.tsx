import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_CARD_CONFIG,
  TOOL_KEYS,
  buildPreview,
  combineSessions,
  computeStats,
  dailyMinutes,
  dayKey,
  dedupeRecords,
  isClaudeCodeLog,
  isExtensionLog,
  isSaneSpan,
  monthlyHours,
  normalizeCardConfig,
  describeShape,
  detectManifest,
  parseClaudeCodeLog,
  parseExtensionLog,
  parseExport,
  sessionize,
  type CardConfig,
  type ImportBatch,
  type ImportPreview as Preview,
  type ParsedExport,
  type Session,
  type SessionizeOptions,
  type ToolKey,
  type ToolStats,
} from "@trackhour/core";
import { DataManager } from "./components/DataManager";
import { Dropzone } from "./components/Dropzone";
import { Heatmap } from "./components/Heatmap";
import { HowEstimated } from "./components/HowEstimated";
import { ImportPreview } from "./components/ImportPreview";
import { MonthlyBars } from "./components/MonthlyBars";
import { StatList } from "./components/StatList";
import { ToolCard } from "./components/ToolCard";
import {
  addImport,
  addMeasuredSessions,
  deleteBatch,
  loadLibrary,
  requestPersistence,
  saveCard,
  saveOptions,
  deleteSessions,
  wipeAll,
  type Library,
} from "./lib/db";
import { requestExtensionLog } from "./lib/extensionBridge";
import { fmtInt } from "./lib/format";
import { ALL_COLOR, TOOL_META } from "./lib/tools";
import { readExport } from "./lib/zip";
import { AccountPage } from "./pages/AccountPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { CardPage } from "./pages/CardPage";
import { useAuth, type Auth } from "./lib/useAuth";

type View = ToolKey | "all";
type Page = "dashboard" | "card" | "account" | "privacy" | "notfound";
type NavPage = Exclude<Page, "notfound">;

const PATHS: Record<NavPage, string> = { dashboard: "/", card: "/card", account: "/account", privacy: "/privacy" };
// The host serves this app for every address, so an address that is not one of these has to be shown as not found here.
const ROUTES = new Map<string, NavPage>([
  ["", "dashboard"],
  ["/index.html", "dashboard"],
  ["/card", "card"],
  ["/account", "account"],
  ["/privacy", "privacy"],
]);
const pageFromPath = (): Page => ROUTES.get(window.location.pathname.replace(/\/+$/, "")) ?? "notfound";

interface Pending {
  fileName: string;
  parsed: ParsedExport;
  preview: Preview;
}

type Report =
  | { kind: "import"; toolKey: ToolKey; added: number; updated: number; unchanged: number }
  | { kind: "measured"; label: string; added: number; alreadyStored: number; estimated: boolean };

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
  const setPage = useCallback((next: NavPage) => {
    window.history.pushState(null, "", PATHS[next]);
    setPageState(next);
  }, []);
  useEffect(() => {
    const onPop = () => setPageState(pageFromPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.title =
      page === "card" ? "Card designer | TrackHour" : page === "account" ? "Account | TrackHour" : page === "privacy" ? "Privacy | TrackHour" : page === "notfound" ? "Not found | TrackHour" : "TrackHour";
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

  // Pull in time the browser extension has measured, if it is installed. Runs when the app opens and
  // whenever the tab comes back into view, since that is when new browsing time will have piled up.
  const libraryReady = library !== null;
  useEffect(() => {
    if (!libraryReady) return;
    let cancelled = false;
    let running = false;
    async function pull() {
      if (running) return;
      running = true;
      try {
        const log = await requestExtensionLog();
        if (cancelled || !isExtensionLog(log)) return;
        const { sessions } = parseExtensionLog(log);
        if (sessions.length === 0) return;
        const result = await addMeasuredSessions(sessions);
        if (cancelled || result.added === 0) return;
        await reload();
        setReport({ kind: "measured", label: "Browser extension", added: result.added, alreadyStored: sessions.length - result.added, estimated: false });
      } catch {
        // The extension is optional; a failed pull just means nothing new this time.
      } finally {
        running = false;
      }
    }
    void pull();
    const onVisible = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    // A session only reaches the app once it has finished, so keep checking while this tab is open.
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [libraryReady, reload]);

  const records = library?.records;
  const options = library?.options;
  const measuredSessions = library?.measuredSessions;

  const derived = useMemo(() => {
    if (!records || !options || !measuredSessions) return null;
    const now = Date.now();
    const ctx = { now, timeZone };
    const estimated = TOOL_KEYS.flatMap((k) => sessionize(records, k, options));
    // Stored sessions are re-checked every time they are read. One with impossible dates (saved by an older
    // version, or a bad file) would otherwise make every chart loop for millions of days and freeze the app.
    const stored = measuredSessions.filter((s) => isSaneSpan(s.startedAt, s.endedAt, now));
    // Measured (Claude Code hook, later a browser extension) wins over an estimate for the time it covers.
    const sessions = combineSessions(
      [...estimated, ...stored.filter((s) => s.confidence === "estimated")],
      stored.filter((s) => s.confidence !== "estimated"),
    );
    const toolsWithData = TOOL_KEYS.filter((k) => records.some((r) => r.toolKey === k) || stored.some((s) => s.toolKey === k));
    // One entry per registered tool, so adding a tool to the registry needs no change here.
    const perTool = Object.fromEntries(TOOL_KEYS.map((k) => [k, computeStats(sessions, records, ctx, k)])) as Record<ToolKey, ToolStats>;
    const stats = { all: computeStats(sessions, records, ctx, "all"), ...perTool };
    return { sessions, toolsWithData, stats, now, today: dayKey(now, timeZone) };
  }, [records, options, measuredSessions, timeZone]);

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
      if (isClaudeCodeLog(json) || isExtensionLog(json)) {
        const fromExtension = isExtensionLog(json);
        const { sessions } = fromExtension ? parseExtensionLog(json) : parseClaudeCodeLog(json);
        if (sessions.length === 0) {
          throw new Error(`This looks like a ${fromExtension ? "browser extension" : "Claude Code"} session log, but it has no usable sessions in it.`);
        }
        const result = await addMeasuredSessions(sessions);
        void requestPersistence();
        await reload();
        setReport({
          kind: "measured",
          label: fromExtension ? "Browser extension" : "Claude Code",
          added: result.added,
          alreadyStored: sessions.length - result.added,
          estimated: sessions.every((s) => s.confidence === "estimated"),
        });
        return;
      }
      const batchId = crypto.randomUUID();
      const parsed = parseExport(json, batchId);
      if (!parsed) {
        const manifest = detectManifest(json);
        if (manifest) {
          throw new Error(
            `This is your export manifest, a list of download links, not your chats. Download ${manifest.conversationsFile ?? "the file whose category is conversations"} from its export_url and drop that ZIP here instead.`,
          );
        }
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
      const { fresh, updated, unchanged } = dedupeRecords(library.records, pending.parsed.records);
      const batch: ImportBatch = {
        id: pending.parsed.records[0].importBatchId,
        toolKey: pending.parsed.toolKey,
        fileName: pending.fileName,
        importedAt: Date.now(),
        conversationCount: fresh.length + updated.length,
      };
      const result = await addImport(batch, fresh, updated);
      void requestPersistence();
      await reload();
      setReport({ kind: "import", toolKey: pending.parsed.toolKey, added: result.added, updated: result.updated, unchanged: unchanged.length });
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

  async function removeSessions(toolKey: Session["toolKey"], source: Session["source"]) {
    if (!window.confirm(`Delete these ${TOOL_META[toolKey].label} sessions? This cannot be undone. You can import the log file again.`)) return;
    await deleteSessions(toolKey, source);
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

  const hasData = library.records.length > 0 || library.measuredSessions.length > 0;
  const viewColor = activeView === "all" ? ALL_COLOR : TOOL_META[activeView].color;
  const viewLabel = activeView === "all" ? "All tools" : TOOL_META[activeView].label;

  return (
    <Shell
      nav={hasData || page === "account" || page === "privacy" || page === "notfound" ? <Tabs page={page} onChange={setPage} auth={auth} /> : null}
      onPrivacy={() => setPage("privacy")}
    >
      {report && report.kind === "import" && (
        <Banner tone="ok" onClose={() => setReport(null)}>
          {TOOL_META[report.toolKey].label}: <strong>{fmtInt(report.added)}</strong> new and <strong>{fmtInt(report.updated)}</strong> updated
          conversations. {fmtInt(report.unchanged)} already imported {report.unchanged === 1 ? "conversation was" : "conversations were"} unchanged and skipped.
        </Banner>
      )}
      {report && report.kind === "measured" && (
        <Banner tone="ok" onClose={() => setReport(null)}>
          {report.label}: <strong>{fmtInt(report.added)}</strong> new {report.estimated ? "estimated" : "measured"} {report.added === 1 ? "session" : "sessions"}.{" "}
          {report.alreadyStored > 0
            ? `${fmtInt(report.alreadyStored)} already recorded ${report.alreadyStored === 1 ? "session was" : "sessions were"} skipped.`
            : "No sessions were skipped."}
        </Banner>
      )}
      {error && (
        <Banner tone="error" onClose={() => setError(null)}>
          {error}
        </Banner>
      )}

      {page === "privacy" ? (
        <PrivacyPage />
      ) : page === "notfound" ? (
        <NotFoundPage onHome={() => setPage("dashboard")} />
      ) : page === "account" ? (
        // Not gated on having imported data: someone signing in on a new device must still reach their profile, and delete it.
        <AccountPage auth={auth} sessions={derived.sessions} records={library.records} now={derived.now} timeZone={timeZone} card={library.card} />
      ) : !hasData ? (
        <div className="py-10">
          <Dropzone onFile={handleFile} busy={busy} />
        </div>
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
              <Heatmap days={days} color={viewColor} today={derived.today} confidence={derived.stats[activeView].confidence} />
            </div>
            <div className="rounded-lg border border-line bg-panel p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">Monthly usage, {viewLabel}</h3>
              <MonthlyBars months={months} color={viewColor} confidence={derived.stats[activeView].confidence} />
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
              sessions={library.measuredSessions}
              timeZone={timeZone}
              onDelete={removeBatch}
              onDeleteSessions={removeSessions}
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

function Tabs({ page, onChange, auth }: { page: Page; onChange: (p: NavPage) => void; auth: Auth }) {
  const tabs: Array<[NavPage, string]> = [
    ["dashboard", "Dashboard"],
    ["card", "Card"],
    ...(auth.configured ? ([["account", "Account"]] as Array<[NavPage, string]>) : []),
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

function Shell({ children, nav, onPrivacy }: { children: React.ReactNode; nav?: React.ReactNode; onPrivacy?: () => void }) {
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
      <footer className="mt-16 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line/60 pt-5 text-xs text-muted">
        <a
          href="/privacy"
          onClick={(e) => {
            if (!onPrivacy || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onPrivacy();
          }}
          className="hover:text-ink"
        >
          Privacy
        </a>
        <a href="https://github.com/malasadongegg/TrackHour" target="_blank" rel="noreferrer noopener" className="hover:text-ink">
          Source code
        </a>
        <a href="https://github.com/malasadongegg/TrackHour/issues" target="_blank" rel="noreferrer noopener" className="hover:text-ink">
          Report a problem
        </a>
      </footer>
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
