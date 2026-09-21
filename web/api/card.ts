/**
 * Vercel function: GET /api/card?u=<slug>
 *
 * A thin adapter. All logic (validation, caching, rate limiting, rendering)
 * lives in card/src and core/src. Imported by PACKAGE NAME (@trackhour/card is
 * a real dependency of web, see package.json), not by a raw relative path: a
 * relative path that reaches outside web/ is unreliable for Vercel's function
 * bundler in a pnpm workspace, since it has to be traced across a package
 * boundary and its own node_modules symlinks. A normal dependency resolves the
 * same way this app's other imports already do.
 *
 * Needs two environment variables in Vercel (server side only):
 *   SUPABASE_URL       your project URL
 *   SUPABASE_ANON_KEY  the public anon key (row level security limits it to public profiles)
 */
import { createRateLimiter, createSupabaseStore, handleCardRequest } from "@trackhour/card";

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

// Per instance only. For real protection put a shared store behind the same RateLimiter interface.
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: Req, res: Res): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Card service is not configured");
    return;
  }

  const forwarded = first(req.headers["x-forwarded-for"]);
  const result = await handleCardRequest(
    {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      ip: forwarded?.split(",")[0]?.trim() || first(req.headers["x-real-ip"]) || "unknown",
      ifNoneMatch: first(req.headers["if-none-match"]),
    },
    { store: createSupabaseStore({ url, anonKey }), limiter },
  );

  res.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  res.end(result.body);
}
