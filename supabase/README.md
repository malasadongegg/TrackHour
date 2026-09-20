# supabase/

Not built yet (phase 2).

Schema, migrations, row level security and auth for a saved profile per user.

**Only aggregate numbers are ever stored server-side.** Never raw exports, message text, conversation titles, or per-message timestamps. Backfilled imports will be pushed as aggregates (for example per-day active minutes and counts, first and last used), marked `source: "import"` and `confidence: "estimated"`.

The `Session` type in `core/src/types.ts` is shaped to match the future `sessions` table. Timestamps are epoch milliseconds in `core` and become `timestamptz` at this boundary.
