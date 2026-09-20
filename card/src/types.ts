import type { CardData } from "@trackhour/core";

/**
 * What a saved profile holds. AGGREGATES ONLY: per-tool stats and per-day
 * active minutes. Never raw exports, message text, titles or per-message
 * timestamps. Mirrors `supabase/migrations/0001_profiles.sql`.
 */
export interface StoredProfile {
  /** Saved card design. Untrusted on read, always normalized by the renderer. */
  config: unknown;
  aggregates: Pick<CardData, "timeZone" | "all" | "byTool" | "daysByTool"> & {
    /** Epoch ms when these aggregates were last computed. */
    updatedAt: number;
  };
}

export interface ProfileStore {
  /** Returns a profile only if its owner made it public. Null when missing or private. */
  getPublicProfile(slug: string): Promise<StoredProfile | null>;
}
