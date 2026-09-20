# card/

The hosted card endpoint's logic. `web/api/card.ts` is the thin Vercel function around it; this package holds everything testable.

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

## Wiring it up

Follow [`supabase/README.md`](../supabase/README.md) to create the table, then set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel. `createSupabaseStore` reads public profiles over Supabase's REST API with the anon key, and row level security limits it to rows their owner made public. Without the variables the function answers 503.

The rate limiter shipped in `web/api/card.ts` is in memory, so each serverless instance counts separately. For real protection implement `RateLimiter` on a shared store (Upstash Redis or Vercel KV) or use platform rate limiting in front.

## Discord

The same card will be posted to Discord as an embed by a bot or webhook. See `extension/` for Rich Presence.
