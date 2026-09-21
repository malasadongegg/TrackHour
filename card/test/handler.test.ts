import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CARD_CONFIG, buildCardData, sessionize, type ConversationRecord } from "@trackhour/core";
import { createRateLimiter, handleCardRequest, type CardRequest, type ProfileStore, type StoredProfile } from "../src";

const NOW = Date.parse("2026-03-11T12:00:00Z");
const at = (iso: string) => Date.parse(iso);

function record(toolKey: "chatgpt" | "claude", ref: string, times: number[]): ConversationRecord {
  return {
    toolKey,
    externalRef: ref,
    createdAt: times[0],
    updatedAt: times[times.length - 1],
    activityTimes: times,
    messageTimes: times,
    userMessages: 1,
    assistantMessages: 1,
    importBatchId: "b",
  };
}

const records = [
  record("chatgpt", "a", [at("2026-03-02T09:00:00Z"), at("2026-03-02T09:10:00Z")]),
  record("claude", "b", [at("2026-03-10T09:00:00Z"), at("2026-03-10T09:12:00Z")]),
];
const sessions = [...sessionize(records, "chatgpt"), ...sessionize(records, "claude")];
const built = buildCardData(sessions, records, { now: NOW, timeZone: "UTC" });

const profile: StoredProfile = {
  config: { ...DEFAULT_CARD_CONFIG, title: "Mark" },
  aggregates: { timeZone: "UTC", updatedAt: NOW, all: built.all, byTool: built.byTool, daysByTool: built.daysByTool },
};

const storeOf = (profiles: Record<string, StoredProfile>): ProfileStore => ({
  getPublicProfile: async (slug) => profiles[slug] ?? null,
});

const generous = () => createRateLimiter({ limit: 1000, windowMs: 60_000, now: () => 0 });
const deps = (over: Partial<Parameters<typeof handleCardRequest>[1]> = {}) => ({
  store: storeOf({ mark: profile }),
  limiter: generous(),
  ...over,
});
const get = (url: string, extra: Partial<CardRequest> = {}): CardRequest => ({ method: "GET", url, ip: "1.1.1.1", ...extra });

describe("handleCardRequest", () => {
  it("returns the profile's card as a cacheable SVG", async () => {
    const res = await handleCardRequest(get("/api/card?u=mark"), deps());
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toContain("image/svg+xml");
    expect(res.headers["Cache-Control"]).toContain("s-maxage");
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(res.body.startsWith("<svg")).toBe(true);
    expect(res.body).toContain("Mark");
    expect(res.body).toContain("ESTIMATED"); // imported data stays labeled on the hosted card too
  });

  it("uses the data's own timestamp for 'Updated', not the request time", async () => {
    const res = await handleCardRequest(get("/api/card?u=mark"), deps());
    expect(res.body).toContain("Updated Mar 11, 2026");
  });

  it("is case insensitive on the profile id", async () => {
    expect((await handleCardRequest(get("/api/card?u=MARK"), deps())).status).toBe(200);
  });

  it("applies style overrides from the query", async () => {
    const res = await handleCardRequest(get("/api/card?u=mark&theme=github-dark&layout=compact&title=Hi"), deps());
    expect(res.body).toContain("#0d1117");
    expect(res.body).toContain('height="72"');
    expect(res.body).toContain(">Hi<");
  });

  it("lets custom colors layer over the saved design", async () => {
    const res = await handleCardRequest(get("/api/card?u=mark&accent=ff00aa"), deps());
    expect(res.body).toContain("#ff00aa");
    expect(res.body).toContain("#1b2838"); // saved background is kept
  });

  it("cannot be injected through the query", async () => {
    const evil = encodeURIComponent('"/><script>alert(1)</script>');
    const res = await handleCardRequest(get(`/api/card?u=mark&accent=${evil}&background=${evil}&title=${evil}&theme=${evil}&layout=${evil}`), deps());
    expect(res.status).toBe(200);
    expect(res.body).not.toContain("<script");
    expect(res.body).not.toContain("alert(1)<");
  });

  it("does not let the query change which tools are drawn", async () => {
    const res = await handleCardRequest(get("/api/card?u=mark&layout=detailed&tools=claude"), deps());
    expect(res.body).toContain("CHATGPT");
    expect(res.body).toContain("CLAUDE");
  });

  it("rejects invalid or missing profile ids without touching the store", async () => {
    let calls = 0;
    const store: ProfileStore = { getPublicProfile: async () => (calls++, null) };
    for (const url of ["/api/card", "/api/card?u=", "/api/card?u=a", "/api/card?u=../etc/passwd", "/api/card?u=x%00y", `/api/card?u=${"a".repeat(41)}`]) {
      expect((await handleCardRequest(get(url), deps({ store }))).status).toBe(400);
    }
    expect(calls).toBe(0);
  });

  it("returns a small SVG, not a broken image, for unknown or private profiles", async () => {
    const res = await handleCardRequest(get("/api/card?u=nobody"), deps());
    expect(res.status).toBe(404);
    expect(res.headers["Content-Type"]).toContain("image/svg+xml");
    expect(res.body).toContain("Profile not found");
  });

  it("never leaks store errors to the response, but does log them server-side for diagnosis", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store: ProfileStore = { getPublicProfile: async () => { throw new Error("password=hunter2 at db.internal"); } };
    const res = await handleCardRequest(get("/api/card?u=mark"), deps({ store }));
    expect(res.status).toBe(500);
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("db.internal");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("store.getPublicProfile"), expect.any(Error));
    spy.mockRestore();
  });

  it("survives malformed stored data", async () => {
    const broken = { config: "garbage", aggregates: { timeZone: "UTC", updatedAt: NOW } } as unknown as StoredProfile;
    const res = await handleCardRequest(get("/api/card?u=mark"), deps({ store: storeOf({ mark: broken }) }));
    expect(res.status).toBe(500);
    expect(res.body.startsWith("<svg")).toBe(true);
  });

  it("only allows GET and HEAD, and HEAD has no body", async () => {
    expect((await handleCardRequest({ ...get("/api/card?u=mark"), method: "POST" }, deps())).status).toBe(405);
    const head = await handleCardRequest({ ...get("/api/card?u=mark"), method: "HEAD" }, deps());
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
  });

  it("rejects absurdly long URLs", async () => {
    expect((await handleCardRequest(get(`/api/card?u=mark&title=${"a".repeat(3000)}`), deps())).status).toBe(414);
  });

  it("supports conditional requests with an ETag", async () => {
    const first = await handleCardRequest(get("/api/card?u=mark"), deps());
    const again = await handleCardRequest(get("/api/card?u=mark", { ifNoneMatch: first.headers.ETag }), deps());
    expect(again.status).toBe(304);
    expect(again.body).toBe("");
    const other = await handleCardRequest(get("/api/card?u=mark&theme=paper-light"), deps());
    expect(other.headers.ETag).not.toBe(first.headers.ETag);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once a caller exceeds the limit", async () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    const d = deps({ limiter });
    for (let i = 0; i < 3; i++) expect((await handleCardRequest(get("/api/card?u=mark"), d)).status).toBe(200);
    t = 10_000;
    const blocked = await handleCardRequest(get("/api/card?u=mark"), d);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["Retry-After"])).toBe(50);
    expect(blocked.body.startsWith("<svg")).toBe(true);
  });

  it("limits per caller and recovers after the window", async () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    const d = deps({ limiter });
    expect((await handleCardRequest(get("/api/card?u=mark", { ip: "a" }), d)).status).toBe(200);
    expect((await handleCardRequest(get("/api/card?u=mark", { ip: "a" }), d)).status).toBe(429);
    expect((await handleCardRequest(get("/api/card?u=mark", { ip: "b" }), d)).status).toBe(200);
    t = 1500;
    expect((await handleCardRequest(get("/api/card?u=mark", { ip: "a" }), d)).status).toBe(200);
  });

  it("does not consult the store for rate limited callers", async () => {
    let calls = 0;
    const store: ProfileStore = { getPublicProfile: async () => (calls++, profile) };
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    const d = deps({ store, limiter });
    await handleCardRequest(get("/api/card?u=mark"), d);
    await handleCardRequest(get("/api/card?u=mark"), d);
    expect(calls).toBe(1);
  });

  it("bounds its own memory", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => 0, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) limiter.check(`ip-${i}`);
    // The oldest keys were evicted, so an early caller starts fresh.
    for (let i = 0; i < 5; i++) expect(limiter.check("ip-0").ok).toBe(true);
    expect(limiter.check("ip-0").ok).toBe(false);
  });
});
