# supabase/

Phase 2. The schema is written but **not applied anywhere**: there is no Supabase project yet.

[`migrations/0001_profiles.sql`](migrations/0001_profiles.sql) creates a `profiles` table with row level security: owners control their own row, and a profile is publicly readable only if its owner set `is_public` (sharing is opt-in).

**Only aggregate numbers are ever stored server-side.** Never raw exports, message text, conversation titles, or per-message timestamps. Backfilled imports will be pushed as aggregates (per-tool stats and per-day active minutes), marked `confidence: "estimated"`. Size checks on the JSON columns keep a row small.

Still to do: auth (sign in and sign up in `web/`), an upload flow that computes aggregates in the browser and saves only those, and a `ProfileStore` implementation for the card endpoint (see [`card/`](../card)).

The `Session` type in `core/src/types.ts` is shaped to match a future `sessions` table. Timestamps are epoch milliseconds in `core` and become `timestamptz` at this boundary.
