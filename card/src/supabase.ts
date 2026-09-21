import type { ProfileStore, StoredProfile } from "./types";

interface Options {
  /** Project URL, e.g. https://abcdefgh.supabase.co */
  url: string;
  /** The public anon key. Row level security decides what it can read. Never pass the service_role key here. */
  anonKey: string;
  fetch?: typeof fetch;
  /**
   * How long a lookup (including "not found") is reused. Anyone can make every
   * card URL unique by adding a random query parameter, which defeats the CDN
   * cache; this keeps such requests from each costing a database read. Kept
   * short so "Update saved totals" still shows up quickly.
   */
  cacheMs?: number;
  /** Upper bound on remembered profiles, so a stream of made-up names cannot grow memory. */
  maxEntries?: number;
  /** Injected clock for tests. */
  now?: () => number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Shape check for stored aggregates, so a malformed row becomes a clean error and not a render crash. */
function isAggregates(v: unknown): v is StoredProfile["aggregates"] {
  return isObj(v) && typeof v.timeZone === "string" && typeof v.updatedAt === "number" && isObj(v.all) && isObj(v.byTool) && isObj(v.daysByTool);
}

/**
 * Reads PUBLIC profiles from Supabase over its REST API with the anon key.
 * Only rows whose owner set is_public are visible: the database's row level
 * security enforces it, and the query asks for it too (belt and braces).
 */
export function createSupabaseStore({ url, anonKey, fetch: doFetch = fetch, cacheMs = 10_000, maxEntries = 500, now = Date.now }: Options): ProfileStore {
  async function lookup(slug: string): Promise<StoredProfile | null> {
    const q = new URL("/rest/v1/profiles", url);
    q.searchParams.set("slug", `eq.${slug}`);
    q.searchParams.set("is_public", "eq.true");
    q.searchParams.set("select", "card_config,aggregates");
    q.searchParams.set("limit", "1");
    const res = await doFetch(q, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`store responded ${res.status}`);
    const rows: unknown = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0];
    if (!isObj(row) || !isAggregates(row.aggregates)) throw new Error("stored profile is malformed");
    return { config: row.card_config, aggregates: row.aggregates };
  }

  // Holds the PROMISE, so a burst of simultaneous requests for one profile shares a single database read.
  const cache = new Map<string, { at: number; value: Promise<StoredProfile | null> }>();

  return {
    getPublicProfile(slug) {
      const t = now();
      const hit = cache.get(slug);
      if (hit && t - hit.at < cacheMs) return hit.value;

      const value = lookup(slug);
      cache.delete(slug); // re-insert so Map order tracks age
      cache.set(slug, { at: t, value });
      if (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      // A failure is never remembered: the next request tries the database again.
      value.catch(() => {
        if (cache.get(slug)?.value === value) cache.delete(slug);
      });
      return value;
    },
  };
}
