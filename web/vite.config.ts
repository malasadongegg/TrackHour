import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * DEV ONLY: serves /api/card locally by running the exact same handler the
 * Vercel function uses, via Vite's ssrLoadModule (which transpiles the TS in
 * card/src on the fly, no build step needed). This exists purely so the card
 * embed can be tested against real Supabase data on localhost, without
 * `vercel dev` or a deployment. It never runs in `vite build` / production.
 */
function localCardApi(env: Record<string, string>): Plugin {
  // Created once, reused across requests, matching how the Vercel function reuses it per instance.
  let limiter: ReturnType<typeof import("../card/src").createRateLimiter> | null = null;

  return {
    name: "local-card-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/card")) return next();
        try {
          const { createRateLimiter, createSupabaseStore, handleCardRequest } = await server.ssrLoadModule("../card/src/index.ts");
          const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
          const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
          if (!url || !anonKey) {
            res.statusCode = 503;
            res.end("Card service is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in web/.env.local.");
            return;
          }
          limiter ??= createRateLimiter({ limit: 120, windowMs: 60_000 });
          const result = await handleCardRequest(
            { method: req.method ?? "GET", url: req.url, ip: "localhost", ifNoneMatch: req.headers["if-none-match"] as string | undefined },
            { store: createSupabaseStore({ url, anonKey }), limiter },
          );
          res.statusCode = result.status;
          for (const [name, value] of Object.entries(result.headers as Record<string, string>)) res.setHeader(name, value);
          res.end(result.body);
        } catch (e) {
          res.statusCode = 500;
          res.end(`Local /api/card dev handler crashed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss(), localCardApi(env)],
  };
});
