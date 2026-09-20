# card/

Not built yet (phase 2).

A hosted endpoint that returns a user's card as an SVG at a stable URL, so it can be embedded as an image anywhere and show current data on every load.

The endpoint adds no rendering logic of its own. It loads a saved aggregate profile and a saved card config, then calls, verbatim:

```ts
import { normalizeCardConfig, renderCard } from "@trackhour/core";
renderCard(normalizeCardConfig(savedConfig), cardData);
```

`normalizeCardConfig` and `renderCard` are written for untrusted input (hex-only colors, XML-escaped text, no external references), so a config from a database or URL is safe to render.

## Abuse and load (required before launch)

A public image URL is an abuse vector, so the endpoint must ship with:

- **Caching.** Set `Cache-Control` with a short `max-age` and `stale-while-revalidate`, and cache rendered SVGs at the edge, so a popular README does not hit the database on every view.
- **Rate limiting.** Per IP and per profile, with a cheap fallback response when limited.
- **Input limits.** Reject oversized or malformed config, and only ever read aggregate numbers, never raw data.
- **Safe headers.** `Content-Type: image/svg+xml` and `X-Content-Type-Options: nosniff`.

## Discord

The same card will be posted to Discord as an embed by a bot or webhook. See `extension/` for Rich Presence.
