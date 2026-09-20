import type { ProfileStore, StoredProfile } from "./types";

interface Options {
  /** Project URL, e.g. https://abcdefgh.supabase.co */
  url: string;
  /** The public anon key. Row level security decides what it can read. Never pass the service_role key here. */
  anonKey: string;
  fetch?: typeof fetch;
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
export function createSupabaseStore({ url, anonKey, fetch: doFetch = fetch }: Options): ProfileStore {
  return {
    async getPublicProfile(slug) {
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
    },
  };
}
