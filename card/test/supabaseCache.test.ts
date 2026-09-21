import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "../src";

const aggregates = { timeZone: "UTC", updatedAt: 1, all: {}, byTool: {}, daysByTool: {} };
const okRow = [{ card_config: {}, aggregates }];

function fakeFetch(handler: (url: string) => Promise<{ ok: boolean; status?: number; json: () => Promise<unknown> }>) {
  const calls: string[] = [];
  const fn = (async (input: URL | string) => {
    calls.push(String(input));
    return handler(String(input));
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const rows = (body: unknown) => async () => ({ ok: true, json: async () => body });

describe("profile lookup cache", () => {
  it("50 simultaneous requests for one profile share a single database read", async () => {
    const { fn, calls } = fakeFetch(rows(okRow));
    const store = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: fn });
    const results = await Promise.all(Array.from({ length: 50 }, () => store.getPublicProfile("mark")));
    expect(calls).toHaveLength(1);
    expect(results.every((r) => r !== null)).toBe(true);
  });

  it("reads again once the window has passed, so saved changes show up", async () => {
    let t = 1000;
    const { fn, calls } = fakeFetch(rows(okRow));
    const store = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: fn, cacheMs: 10_000, now: () => t });
    await store.getPublicProfile("mark");
    t += 9_999;
    await store.getPublicProfile("mark");
    expect(calls).toHaveLength(1);
    t += 2;
    await store.getPublicProfile("mark");
    expect(calls).toHaveLength(2);
  });

  it("remembers a missing profile too, so made-up names cannot each cost a read", async () => {
    const { fn, calls } = fakeFetch(rows([]));
    const store = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: fn });
    for (let i = 0; i < 20; i++) expect(await store.getPublicProfile("nobody")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("never remembers a failure", async () => {
    let fail = true;
    const { fn, calls } = fakeFetch(async () => (fail ? { ok: false, status: 500, json: async () => ({}) } : { ok: true, json: async () => okRow }));
    const store = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: fn });
    await expect(store.getPublicProfile("mark")).rejects.toThrow();
    fail = false;
    expect(await store.getPublicProfile("mark")).not.toBeNull();
    expect(calls).toHaveLength(2);
  });

  it("keeps profiles apart and never holds more than maxEntries", async () => {
    const { fn, calls } = fakeFetch(rows(okRow));
    const store = createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: fn, maxEntries: 3 });
    for (const s of ["aaa", "bbb", "ccc", "ddd"]) await store.getPublicProfile(s);
    expect(calls).toHaveLength(4);
    await store.getPublicProfile("ddd"); // still remembered
    expect(calls).toHaveLength(4);
    await store.getPublicProfile("aaa"); // evicted as the oldest
    expect(calls).toHaveLength(5);
  });

  it("still asks only for public rows and only the columns a card needs", async () => {
    const { fn, calls } = fakeFetch(rows(okRow));
    await createSupabaseStore({ url: "https://x.supabase.co", anonKey: "k", fetch: fn }).getPublicProfile("mark");
    const q = new URL(calls[0]).searchParams;
    expect(q.get("is_public")).toBe("eq.true");
    expect(q.get("select")).toBe("card_config,aggregates");
    expect(q.get("slug")).toBe("eq.mark");
  });
});
