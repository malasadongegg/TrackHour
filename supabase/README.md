# supabase/

Accounts and hosted cards (phase 2).

**Only aggregate numbers are ever stored server-side.** Never raw exports, message text, conversation titles, or per-message timestamps. What is saved is the card design plus per-tool stats and per-day active minutes for the last 30 weeks (see `toAggregates` in `core/src/card/data.ts`). The Account page shows the exact payload before saving.

## One-time setup

1. **Create the tables.** In your Supabase project open SQL Editor, paste [`migrations/0001_profiles.sql`](migrations/0001_profiles.sql), and run it. It creates `profiles` with row level security: owners control their own row, and a row is publicly readable only if its owner set `is_public`.
2. **Register a GitHub OAuth app** (this is sign-in for this site only). At github.com/settings/developers create a new OAuth App. Set the authorization callback URL to `https://<your-project-ref>.supabase.co/auth/v1/callback`. Copy the Client ID and generate a Client Secret.
3. **Enable GitHub in Supabase.** Authentication, Providers, GitHub: turn it on and paste the Client ID and Secret.
4. **Allow your site URLs.** Authentication, URL Configuration: set the Site URL to your production URL, and add these Redirect URLs: `http://localhost:5173/account` and `https://<your-domain>/account`.
5. **Local env.** Copy `web/.env.example` to `web/.env.local` and fill in your project URL and **anon** key (Project Settings, API). Restart the dev server. The Account tab appears once both are set.
6. **Vercel env.** Add the four variables listed in the root README.

## Keys

- The **anon** key is public by design and safe in the browser. Row level security is what protects data.
- The **service_role** key bypasses security. It is never needed by this project. Do not put it in any `VITE_` variable, in the repo, or in chat.

## Notes

- Backfilled numbers stay labeled estimated on the hosted card too.
- The schema has size checks on both JSON columns so a row cannot grow without bound.
- The `Session` type in `core/src/types.ts` is shaped to match a possible future `sessions` table. Timestamps are epoch milliseconds in `core` and become `timestamptz` at this boundary.
