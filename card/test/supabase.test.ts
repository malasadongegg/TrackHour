import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "../src";

const okRow = { card_config: {}, aggregates: { timeZone: "UTC", updatedAt: 1, all: {}, byTool: {}, daysByTool: {} } };
const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("createSupabaseStore", () => {
  it("asks for one public row by slug with the anon key, and only the columns it needs", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const store = createSupabaseStore({
      url: "https://x.supabase.co",
      anonKey: "anon",
      fetch: (async (u: URL, init: RequestInit) => {
        seen = { url: String(u), headers: init.headers as Record<string, string> };
        return new Response(JSON.stringify([okRow]));
      }) as unknown as typeof fetch,
    });
    const p = await store.getPublicProfile("mark");
    expect(p?.aggregates.timeZone).toBe("UTC");
    const u = new URL(seen!.url);
    expect(u.pathname).toBe("/rest/v1/profiles");
    expect(u.searchParams.get("slug")).toBe("eq.mark");
    expect(u.searchParams.get("is_public")).toBe("eq.true");
    expect(u.searchParams.get("select")).toBe("card_config,aggregates");
    expect(seen!.headers.apikey).toBe("anon");
  });

  it("returns null when nothing matches (unknown or private)", async () => {
    const store = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: respond([]) as unknown as typeof fetch });
    expect(await store.getPublicProfile("nobody")).toBeNull();
  });

  it("throws on HTTP errors and on malformed rows, so the handler answers 500 without leaking", async () => {
    const bad = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: respond({ message: "boom" }, 500) as unknown as typeof fetch });
    await expect(bad.getPublicProfile("mark")).rejects.toThrow();
    const malformed = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: respond([{ card_config: {}, aggregates: "nope" }]) as unknown as typeof fetch });
    await expect(malformed.getPublicProfile("mark")).rejects.toThrow();
  });
});
