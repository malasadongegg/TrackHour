import { useEffect, useMemo, useState } from "react";
import {
  buildCardData,
  normalizeCardConfig,
  toAggregates,
  type CardConfig,
  type ConversationRecord,
  type Session,
} from "@trackhour/core";
import { supabase } from "../lib/supabase";
import type { Auth } from "../lib/useAuth";

interface Props {
  auth: Auth;
  sessions: Session[];
  records: ConversationRecord[];
  now: number;
  timeZone: string;
  card: CardConfig;
}

interface Saved {
  slug: string;
  is_public: boolean;
  updated_at: string;
  card_config: unknown;
}

/** Deep-equal enough for a config object: same normalized shape serializes the same. */
const sameConfig = (a: CardConfig, b: unknown) => JSON.stringify(normalizeCardConfig(a)) === JSON.stringify(normalizeCardConfig(b));

const SLUG = /^[a-z0-9_-]{3,40}$/;

/** A default handle from the GitHub username, cleaned to the allowed pattern. */
function suggestSlug(name: unknown): string {
  const s = String(name ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return s.length >= 3 ? s : "";
}

export function AccountPage({ auth, sessions, records, now, timeZone, card }: Props) {
  const { user } = auth;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [slug, setSlug] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Bumped after every successful save, appended to the preview <img> only, so it reloads
  // immediately instead of showing the browser's cached (now stale) copy of the same URL.
  const [previewNonce, setPreviewNonce] = useState(0);

  // The exact payload that would be uploaded. Computed in the browser and shown before saving.
  // card.tools is a fresh array every render (normalizeCardConfig always rebuilds it), so this
  // depends on its contents rather than the array itself; see the matching note in CardPage.
  const toolsKey = card.tools.join(",");
  const aggregates = useMemo(
    () => toAggregates(buildCardData(sessions, records, { now, timeZone }, card.tools)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toolsKey stands in for card.tools on purpose
    [sessions, records, now, timeZone, toolsKey],
  );
  const payload = useMemo(() => JSON.stringify({ card_config: card, aggregates }, null, 2), [card, aggregates]);

  useEffect(() => {
    const client = supabase();
    if (!client || !user) return;
    let active = true;
    void client
      .from("profiles")
      .select("slug,is_public,updated_at,card_config")
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage({ tone: "error", text: "Could not load your profile." });
        const row = data as Saved | null;
        setSaved(row);
        setSlug(row?.slug ?? suggestSlug(user.user_metadata?.user_name ?? user.user_metadata?.preferred_username));
        setIsPublic(row?.is_public ?? true);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (!auth.configured) {
    return (
      <p className="rounded-lg border border-line bg-panel p-5 text-sm text-muted">
        Accounts are not set up for this copy of the app. Everything else works without them.
      </p>
    );
  }
  if (auth.loading) return <p className="text-sm text-muted">Loading...</p>;

  if (!user) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-lg border border-line bg-panel p-6">
        <h2 className="text-lg font-semibold text-white">Get a hosted card link</h2>
        <p className="text-sm text-ink">
          Sign in to save your totals and get a link that shows your current card anywhere an image can go. You still import your exports in this browser.
        </p>
        <p className="rounded border border-line bg-bg p-3 text-sm text-muted">
          Only totals, dates and daily minutes are uploaded. Your chats, titles and files never leave your device, and you can see the exact data before you save.
        </p>
        <button
          type="button"
          onClick={() => void auth.signInWithGitHub()}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg hover:brightness-110"
        >
          Sign in with GitHub
        </button>
      </div>
    );
  }

  const cardUrl = saved ? `${window.location.origin}/api/card?u=${saved.slug}` : "";
  const previewUrl = saved ? `${cardUrl}&t=${previewNonce}` : "";
  const snippet = `![My AI playtime](${cardUrl})`;
  // True once you've changed the design or your stats since the last publish, so the
  // live card no longer matches what you're looking at in the designer.
  const designChanged = saved !== null && !sameConfig(card, saved.card_config);

  async function save() {
    const client = supabase();
    if (!client || !user) return;
    const clean = slug.trim().toLowerCase();
    if (!SLUG.test(clean)) {
      setMessage({ tone: "error", text: "Use 3 to 40 characters: lowercase letters, numbers, dash or underscore." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data, error } = await client
      .from("profiles")
      .upsert(
        { user_id: user.id, slug: clean, is_public: isPublic, card_config: normalizeCardConfig(card), aggregates },
        { onConflict: "user_id" },
      )
      .select("slug,is_public,updated_at,card_config")
      .single();
    setBusy(false);
    if (error) {
      setMessage({ tone: "error", text: error.code === "23505" ? "That name is taken. Try another." : "Could not save. Please try again." });
      return;
    }
    setSaved(data as Saved);
    setPreviewNonce((n) => n + 1);
    setMessage({ tone: "ok", text: "Saved. Your card link is up to date." });
  }

  async function remove() {
    const client = supabase();
    if (!client || !saved || !user) return;
    if (!window.confirm("Delete your saved profile from the server? Your local data stays on this device.")) return;
    const { error } = await client.from("profiles").delete().eq("user_id", user.id);
    if (error) {
      setMessage({ tone: "error", text: "Could not delete. Please try again." });
      return;
    }
    setSaved(null);
    setMessage({ tone: "ok", text: "Deleted from the server." });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-4 rounded-lg border border-line bg-panel p-5" aria-label="Profile">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Your profile</h2>
          <button type="button" onClick={() => void auth.signOut()} className="text-sm text-muted hover:text-ink">
            Sign out
          </button>
        </div>
        <p className="text-xs text-muted">Signed in as {String(user.user_metadata?.user_name ?? user.email ?? "you")}.</p>

        <label className="block space-y-1 text-sm">
          <span className="text-ink">Card name</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            spellCheck={false}
            aria-invalid={slug !== "" && !SLUG.test(slug.trim().toLowerCase())}
            className="w-full rounded border border-line bg-bg px-3 py-2 text-white"
            placeholder="your-name"
          />
        </label>
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-4 w-4 accent-[#66c0f4]" />
          Anyone with the link can see my card
        </label>
        {!isPublic && <p className="text-xs text-muted">While private, your card link will not work.</p>}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || !loaded}
            onClick={() => void save()}
            className={`rounded px-4 py-2 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50 ${
              designChanged ? "bg-warn" : "bg-accent"
            }`}
          >
            {busy ? "Saving..." : saved ? "Update saved totals" : "Save my totals"}
          </button>
          {saved && (
            <button type="button" onClick={() => void remove()} className="rounded border border-danger/50 px-3 py-2 text-sm text-danger hover:bg-danger/10">
              Delete from server
            </button>
          )}
        </div>
        {!message && designChanged && (
          <p role="status" className="text-sm text-warn">
            Your card design changed since you last published. Press Update saved totals to make the link match what you see on the Card
            tab.
          </p>
        )}
        {message && (
          <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-danger" : "text-accent"}`}>
            {message.text}
          </p>
        )}

        {saved && (
          <div className="space-y-2 border-t border-line/60 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Embed</p>
              {designChanged && <span className="text-xs text-warn">Not yet published</span>}
            </div>
            <img src={previewUrl} alt="Your hosted card" className="h-auto max-w-full rounded" width={495} />
            <code className="block break-all rounded bg-bg p-2 text-xs text-ink">{snippet}</code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(snippet).then(() => setCopied(true));
                window.setTimeout(() => setCopied(false), 2000);
              }}
              className="text-sm text-accent hover:underline"
            >
              {copied ? "Copied" : "Copy Markdown"}
            </button>
            <p className="text-xs text-muted">
              The link only updates when you press Update saved totals. Changing the design on the Card tab or importing new data does not
              publish by itself.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-panel p-5" aria-label="What is uploaded">
        <h2 className="text-lg font-semibold text-white">Exactly what gets uploaded</h2>
        <p className="text-sm text-muted">
          This is the complete payload, computed in your browser. It has your card design, totals per tool, and daily minutes for the last 30 weeks. No messages, no titles, no per-message timestamps.
        </p>
        <details className="rounded border border-line bg-bg">
          <summary className="cursor-pointer px-3 py-2 text-sm text-ink">Show the data ({(new Blob([payload]).size / 1024).toFixed(1)} KB)</summary>
          <pre className="max-h-96 overflow-auto px-3 pb-3 text-xs text-muted">{payload}</pre>
        </details>
      </section>
    </div>
  );
}
