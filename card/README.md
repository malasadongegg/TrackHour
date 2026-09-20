# card/

The hosted card endpoint's logic (phase 2). It is built and tested, but **not deployed**: it needs a Supabase project and a thin serverless adapter, both of which come with phase 2 setup.

`handleCardRequest(request, { store, limiter })` returns `{ status, headers, body }` and has no framework attached. All rendering is `@trackhour/core`'s `renderCard`, verbatim, so a hosted card is byte for byte what the designer previews.

```
GET /api/card?u=<slug>[&theme=github-dark][&layout=compact|detailed|showcase]
              [&title=..][&accent=ff00aa][&stats=hoursOnRecord,sessions][&heatmap=0|1]
```

The saved design comes first, and query parameters override styling only. Which tools appear is fixed by the saved design, because stored combined stats cover exactly that set.

## Built in

- **Untrusted input everywhere.** The slug is pattern checked, and the stored config and every query override go through `normalizeCardConfig` (hex-only colors, known keys only). Text is XML-escaped by the renderer.
- **Caching.** `Cache-Control` with `s-maxage` and `stale-while-revalidate`, plus a weak `ETag` and 304 support.
- **Rate limiting.** Per caller, with `Retry-After`. The in-memory limiter is for tests and a single instance. Production needs the same `RateLimiter` interface backed by a shared store (for example Upstash Redis or Vercel KV), or the platform's rate limiting in front.
- **Graceful failures.** Errors return a small SVG so a README shows a message instead of a broken image, and never leak internals.
- **Aggregates only.** The store interface can only return aggregate numbers. Freshness on the card ("Updated ...") is the data's own timestamp.
- **Honest labels.** Imported data stays labeled Estimated on the hosted card too.

## Wiring it up (phase 2 setup)

1. Create a Supabase project and run [`supabase/migrations/0001_profiles.sql`](../supabase/migrations/0001_profiles.sql).
2. Implement `ProfileStore.getPublicProfile(slug)` with the Supabase client (anon key, public rows only).
3. Add a serverless function that maps its request to `CardRequest`, calls `handleCardRequest`, and copies the response out. Put a shared-store `RateLimiter` behind it.
4. Deploy that function separately from the static site, or under `web/api` if you keep one Vercel project. That changes the current "static build, no server" deploy, so it is a deliberate step.

## Discord

The same card will be posted to Discord as an embed by a bot or webhook. See `extension/` for Rich Presence.
