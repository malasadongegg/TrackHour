/**
 * The hosted card endpoint's logic, with no framework attached.
 *
 *   handleCardRequest(request, deps) -> { status, headers, body }
 *
 * A thin adapter (Vercel function, Cloudflare worker, Express) turns its own
 * request into a CardRequest and copies the response out. All rendering is
 * `@trackhour/core`'s `renderCard`, verbatim, so the card here is byte for byte
 * what the designer previews.
 *
 * This is a public image URL, so it is an abuse vector and is written that way:
 *  - every input is untrusted: the profile id is pattern checked, the stored
 *    config and every query override go through `normalizeCardConfig`, and text
 *    is XML-escaped by the renderer
 *  - per-caller rate limiting, and cache headers so a popular README does not
 *    hit the store on every view
 *  - failures return a small SVG (READMEs show a broken image otherwise) and
 *    never leak internals
 *  - it only ever reads aggregate numbers from the store
 */

import { normalizeCardConfig, renderCard, type CardData } from "@trackhour/core";
import type { RateLimiter } from "./ratelimit";
import type { StoredProfile, ProfileStore } from "./types";

export interface CardRequest {
  method: string;
  /** Full or relative URL, e.g. "/api/card?u=mark&theme=github-dark". */
  url: string;
  /** Caller identity for rate limiting, usually the client IP. */
  ip: string;
  /** Value of the If-None-Match header, if any. */
  ifNoneMatch?: string | null;
}

export interface CardResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface CardDeps {
  store: ProfileStore;
  limiter: RateLimiter;
}

const PROFILE_ID = /^[a-z0-9_-]{3,40}$/;
const MAX_URL_LENGTH = 2000;
const COLOR_KEYS = ["background", "text", "accent", "muted"] as const;

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  // If the SVG is ever opened directly, nothing in it may run or load.
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
} as const;

/** Edge and browser caching: fresh for 5 minutes, served stale for a day while revalidating. */
const CACHE_OK = "public, max-age=300, s-maxage=900, stale-while-revalidate=86400";
const CACHE_ERROR = "public, max-age=60";

/** A small, fixed SVG for errors. Contains no user input. */
function messageSvg(message: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="72" viewBox="0 0 495 72" role="img" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">` +
    `<title>${message}</title>` +
    `<rect x="0.5" y="0.5" width="494" height="71" rx="10" fill="#1b2838" stroke="#8f98a0" stroke-opacity="0.35"/>` +
    `<text x="247.5" y="41" font-size="13" text-anchor="middle" fill="#8f98a0">${message}</text>` +
    `</svg>`
  );
}

function fail(status: number, message: string, extra: Record<string, string> = {}): CardResponse {
  return { status, headers: { ...SVG_HEADERS, "Cache-Control": CACHE_ERROR, ...extra }, body: messageSvg(message) };
}

/** Style overrides from the query string. Untrusted: the result is normalized before use. */
function overridesFrom(params: URLSearchParams): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const theme = params.get("theme");
  if (theme) o.theme = theme;
  const layout = params.get("layout");
  if (layout) o.layout = layout;
  const title = params.get("title");
  if (title !== null) o.title = title;
  const stats = params.get("stats");
  if (stats !== null) o.stats = stats.split(",").filter(Boolean);
  const heatmap = params.get("heatmap");
  if (heatmap === "0" || heatmap === "1") o.showHeatmap = heatmap === "1";

  const colors: Record<string, string> = {};
  for (const key of COLOR_KEYS) {
    const v = params.get(key);
    if (v) colors[key] = v.startsWith("#") ? v : `#${v}`;
  }
  if (Object.keys(colors).length > 0) o.colors = colors;
  return o;
}

/**
 * Saved design first, then query overrides. Tools are deliberately NOT
 * overridable: the stored combined stats cover exactly the saved tool set.
 */
function resolveConfig(saved: unknown, params: URLSearchParams) {
  const base = normalizeCardConfig(saved);
  const o = overridesFrom(params);
  const merged: Record<string, unknown> = { ...base, ...o };
  if (o.colors) {
    // Custom colors given: they layer over the saved colors unless a theme was also named.
    merged.theme = o.theme ?? "custom";
    merged.colors = { ...(o.theme ? {} : base.colors), ...(o.colors as object) };
  } else if (o.theme) {
    delete merged.colors; // let the named theme supply its own colors
  }
  return normalizeCardConfig(merged);
}

function toCardData(p: StoredProfile): CardData {
  const a = p.aggregates;
  // generatedAt is the data's own freshness, so "Updated <date>" on the card is truthful.
  return { timeZone: a.timeZone, generatedAt: a.updatedAt, all: a.all, byTool: a.byTool, daysByTool: a.daysByTool };
}

/** Small non-cryptographic hash, enough for a weak ETag. */
function etagOf(body: string): string {
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `W/"${(h >>> 0).toString(16)}-${body.length}"`;
}

export async function handleCardRequest(req: CardRequest, deps: CardDeps): Promise<CardResponse> {
  if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "Method not allowed", { Allow: "GET, HEAD" });
  if (req.url.length > MAX_URL_LENGTH) return fail(414, "Request too long");

  const limit = deps.limiter.check(req.ip);
  if (!limit.ok) return fail(429, "Too many requests", { "Retry-After": String(limit.retryAfterSeconds) });

  let params: URLSearchParams;
  try {
    params = new URL(req.url, "https://card.invalid").searchParams;
  } catch {
    return fail(400, "Bad request");
  }
  const id = (params.get("u") ?? "").toLowerCase();
  if (!PROFILE_ID.test(id)) return fail(400, "Missing or invalid profile");

  let profile: StoredProfile | null;
  try {
    profile = await deps.store.getPublicProfile(id);
  } catch {
    return fail(500, "Card unavailable"); // never expose the store's error
  }
  if (!profile) return fail(404, "Profile not found");

  let svg: string;
  try {
    svg = renderCard(resolveConfig(profile.config, params), toCardData(profile));
  } catch {
    return fail(500, "Card unavailable"); // e.g. malformed stored aggregates
  }

  const etag = etagOf(svg);
  const headers = { ...SVG_HEADERS, "Cache-Control": CACHE_OK, ETag: etag };
  if (req.ifNoneMatch && req.ifNoneMatch === etag) return { status: 304, headers, body: "" };
  return { status: 200, headers, body: req.method === "HEAD" ? "" : svg };
}
