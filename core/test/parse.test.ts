import { describe, expect, it } from "vitest";
import { buildPreview, dedupeRecords } from "../src/importing";
import { detectProvider, parseChatGPT, parseClaude, parseExport } from "../src/parse";
import { at, rec } from "./helpers";

const NOW = at("2026-06-01T00:00:00Z");
const sec = (iso: string) => at(iso) / 1000; // ChatGPT uses float unix seconds

/**
 * root(system, null message) -> u1 -> a1 (abandoned regeneration)
 *                                  -> a1b (current branch) -> u2 -> a2 (current)
 * A tool node and a node with a null create_time are also present.
 */
function chatgptConversation() {
  const node = (id: string, parent: string | null, role: string | null, t: number | null, extra = {}) => ({
    id,
    parent,
    children: [],
    message: role
      ? { id, author: { role }, create_time: t, content: { parts: ["x"] }, ...extra }
      : null,
  });
  return {
    id: "conv-1",
    title: "Tree test",
    create_time: sec("2026-03-02T09:00:00Z"),
    update_time: sec("2026-03-02T09:10:00Z"),
    current_node: "a2",
    mapping: {
      root: node("root", null, null, null),
      sys: node("sys", "root", "system", null),
      u1: node("u1", "sys", "user", sec("2026-03-02T09:00:00Z")),
      a1: node("a1", "u1", "assistant", sec("2026-03-02T09:00:30Z")),
      a1b: node("a1b", "u1", "assistant", sec("2026-03-02T09:01:00Z")),
      tool: node("tool", "a1b", "tool", sec("2026-03-02T09:02:00Z")),
      u2: node("u2", "a1b", "user", sec("2026-03-02T09:05:00Z")),
      a2: node("a2", "u2", "assistant", null),
    },
  };
}

function claudeConversation(uuid = "claude-1") {
  return {
    uuid,
    name: "Hello",
    created_at: "2026-03-02T09:00:00.000000Z",
    updated_at: "2026-03-02T09:05:00.000000Z",
    chat_messages: [
      { uuid: "m1", sender: "human", text: "hi", created_at: "2026-03-02T09:00:00.000000Z" },
      { uuid: "m2", sender: "assistant", text: "hello", created_at: "2026-03-02T09:00:20.000000Z" },
      { uuid: "m3", sender: "human", text: "more", created_at: "2026-03-02T09:05:00.000000Z" },
    ],
  };
}

describe("detectProvider", () => {
  it("detects by field, not by file name", () => {
    expect(detectProvider([chatgptConversation()])).toBe("chatgpt");
    expect(detectProvider([claudeConversation()])).toBe("claude");
  });

  it("rejects things that are not conversation exports", () => {
    expect(detectProvider([])).toBeNull();
    expect(detectProvider({ hello: 1 })).toBeNull();
    expect(detectProvider("nope")).toBeNull();
    expect(detectProvider([{ foo: 1 }])).toBeNull();
    expect(parseExport({ nope: true }, "b")).toBeNull();
  });
});

describe("parseChatGPT", () => {
  const { records, skipped } = parseChatGPT([chatgptConversation()], "b1", NOW);
  const r = records[0];

  it("collects activity from EVERY node with a real timestamp, including abandoned branches and tool nodes", () => {
    expect(r.activityTimes).toHaveLength(5); // u1, a1, a1b, tool, u2 (a2 and sys have null times)
    expect(r.activityTimes).toEqual([...r.activityTimes].sort((a, b) => a - b));
  });

  it("counts messages only on the visible branch and only for user/assistant", () => {
    // Visible path: u1, a1b, u2, a2. The regenerated a1 and the tool/system nodes do not count.
    expect(r.userMessages).toBe(2);
    expect(r.assistantMessages).toBe(2);
  });

  it("tracks message timestamps separately from activity", () => {
    // a2 has no timestamp, so 3 of the 4 counted messages have one.
    expect(r.messageTimes).toHaveLength(3);
  });

  it("carries identity and metadata", () => {
    expect(r.toolKey).toBe("chatgpt");
    expect(r.externalRef).toBe("conv-1");
    expect(r.importBatchId).toBe("b1");
    expect(skipped).toBe(0);
  });

  it("falls back to counting all user/assistant nodes when current_node is missing", () => {
    const conv = { ...chatgptConversation(), current_node: undefined };
    const [rec2] = parseChatGPT([conv], "b", NOW).records;
    expect(rec2.userMessages).toBe(2);
    expect(rec2.assistantMessages).toBe(3); // a1, a1b, a2
  });

  it("accepts conversation_id instead of id and ignores implausible timestamps", () => {
    const conv: any = chatgptConversation();
    delete conv.id;
    conv.conversation_id = "alt-id";
    conv.mapping.u1.message.create_time = 0;
    const [rec2] = parseChatGPT([conv], "b", NOW).records;
    expect(rec2.externalRef).toBe("alt-id");
    expect(rec2.activityTimes).toHaveLength(4);
  });

  it("skips malformed and empty conversations without throwing", () => {
    const empty = { id: "e", title: "empty", mapping: {} };
    const res = parseChatGPT([null, 5, { id: "no-mapping" }, empty, chatgptConversation()], "b", NOW);
    expect(res.records).toHaveLength(1);
    expect(res.skipped).toBe(4);
  });

  it("uses the creation time as one activity point if no message has a timestamp", () => {
    const conv: any = chatgptConversation();
    for (const n of Object.values<any>(conv.mapping)) if (n.message) n.message.create_time = null;
    const [rec2] = parseChatGPT([conv], "b", NOW).records;
    expect(rec2.activityTimes).toEqual([at("2026-03-02T09:00:00Z")]);
    expect(rec2.userMessages + rec2.assistantMessages).toBe(4);
  });
});

describe("parseClaude", () => {
  const { records } = parseClaude([claudeConversation()], "b2", NOW);
  const r = records[0];

  it("maps human to user and counts every message", () => {
    expect(r.userMessages).toBe(2);
    expect(r.assistantMessages).toBe(1);
  });

  it("parses ISO timestamps into activity and message times", () => {
    expect(r.activityTimes).toEqual([at("2026-03-02T09:00:00Z"), at("2026-03-02T09:00:20Z"), at("2026-03-02T09:05:00Z")]);
    expect(r.messageTimes).toEqual(r.activityTimes);
    expect(r.toolKey).toBe("claude");
    expect(r.externalRef).toBe("claude-1");
  });

  it("ignores unknown senders and skips conversations with no messages", () => {
    const weird = { ...claudeConversation("w"), chat_messages: [{ sender: "system", created_at: "2026-03-02T09:00:00Z" }] };
    const res = parseClaude([weird, { uuid: "x", chat_messages: [] }, { nope: 1 }], "b", NOW);
    expect(res.records).toHaveLength(0);
    expect(res.skipped).toBe(3);
  });

  it("accepts a wrapper object with a conversations array", () => {
    expect(parseExport({ conversations: [claudeConversation()] }, "b", NOW)?.records).toHaveLength(1);
  });
});

describe("dedupe and preview", () => {
  const a = rec("chatgpt", [at("2026-03-02T09:00:00Z"), at("2026-03-02T09:10:00Z")], { externalRef: "a" });
  const b = rec("chatgpt", [at("2026-03-05T09:00:00Z")], { externalRef: "b" });
  const c = rec("chatgpt", [at("2026-03-09T09:00:00Z")], { externalRef: "c" });

  it("skips conversations already stored and repeats inside the file", () => {
    const { fresh, duplicates } = dedupeRecords([a], [a, b, b, c]);
    expect(fresh.map((r) => r.externalRef)).toEqual(["b", "c"]);
    expect(duplicates).toHaveLength(2);
  });

  it("does not treat the same id in a different tool as a duplicate", () => {
    const other = rec("claude", [at("2026-03-02T09:00:00Z")], { externalRef: "a" });
    expect(dedupeRecords([a], [other]).fresh).toHaveLength(1);
  });

  it("previews only what would actually be added", () => {
    const p = buildPreview("chatgpt", [a], [a, b, c], 2);
    expect(p.conversationsInFile).toBe(3);
    expect(p.newConversations).toBe(2);
    expect(p.duplicateConversations).toBe(1);
    expect(p.skippedConversations).toBe(2);
    expect(p.earliest).toBe(at("2026-03-05T09:00:00Z"));
    expect(p.latest).toBe(at("2026-03-09T09:00:00Z"));
    expect(p.estimatedSessions).toBe(2);
    expect(p.estimatedSeconds).toBe(120); // two single-message sessions, floored to 1 minute
    expect(p.messages.total).toBe(2);
  });

  it("previews an all-duplicate re-import as empty", () => {
    const p = buildPreview("chatgpt", [a, b], [a, b]);
    expect(p.newConversations).toBe(0);
    expect(p.estimatedSessions).toBe(0);
    expect(p.earliest).toBeNull();
  });
});

describe("privacy: only timestamps and counts are extracted", () => {
  const SECRET = "TOP-SECRET-CONTENT";

  it("never copies message text or conversation titles from a ChatGPT export", () => {
    const conv: any = chatgptConversation();
    conv.title = `${SECRET} title`;
    for (const n of Object.values<any>(conv.mapping)) if (n.message) n.message.content = { parts: [`${SECRET} body`] };
    const { records } = parseChatGPT([conv], "b", NOW);
    expect(JSON.stringify(records)).not.toContain("TOP-SECRET");
  });

  it("never copies message text or conversation names from a Claude export", () => {
    const conv: any = claudeConversation();
    conv.name = `${SECRET} name`;
    for (const m of conv.chat_messages) m.text = `${SECRET} body`;
    const { records } = parseClaude([conv], "b", NOW);
    expect(JSON.stringify(records)).not.toContain("TOP-SECRET");
  });

  it("only produces the fields of ConversationRecord, and only ids, numbers and arrays of numbers", () => {
    const { records } = parseClaude([claudeConversation()], "b", NOW);
    const allowed = ["toolKey", "externalRef", "createdAt", "updatedAt", "activityTimes", "messageTimes", "userMessages", "assistantMessages", "importBatchId"];
    expect(Object.keys(records[0]).sort()).toEqual([...allowed].sort());
  });

  it("does not derive a fallback id from the title", () => {
    const conv: any = chatgptConversation();
    delete conv.id;
    conv.title = SECRET;
    const [r] = parseChatGPT([conv], "b", NOW).records;
    expect(r.externalRef.startsWith("noid:")).toBe(true);
    expect(r.externalRef).not.toContain("SECRET");
  });
});

describe("parsing odd export shapes", () => {
  it("reads Claude message times from content blocks when created_at is missing", () => {
    const conv: any = claudeConversation();
    for (const m of conv.chat_messages) {
      m.content = [{ type: "text", start_timestamp: m.created_at, stop_timestamp: m.created_at }];
      delete m.created_at;
    }
    const [r] = parseClaude([conv], "b", NOW).records;
    expect(r.messageTimes).toHaveLength(3);
    expect(r.userMessages + r.assistantMessages).toBe(3);
  });

  it("accepts ChatGPT timestamps as numeric strings or milliseconds", () => {
    const conv: any = chatgptConversation();
    conv.mapping.u1.message.create_time = String(sec("2026-03-02T09:00:00Z"));
    conv.mapping.a1b.message.create_time = at("2026-03-02T09:01:00Z"); // already ms
    const [r] = parseChatGPT([conv], "b", NOW).records;
    expect(r.activityTimes).toContain(at("2026-03-02T09:00:00Z"));
    expect(r.activityTimes).toContain(at("2026-03-02T09:01:00Z"));
  });

  it("survives messages with no author, non-string parts, and null content", () => {
    const conv: any = chatgptConversation();
    conv.mapping.u1.message.author = undefined;
    conv.mapping.a1b.message.content = null;
    conv.mapping.u2.message.content = { parts: [{ asset_pointer: "x" }, 5, null] };
    expect(() => parseChatGPT([conv], "b", NOW)).not.toThrow();
  });

  it("survives a cyclic parent chain", () => {
    const conv: any = chatgptConversation();
    conv.mapping.root.parent = "a2";
    const [r] = parseChatGPT([conv], "b", NOW).records;
    expect(r.userMessages + r.assistantMessages).toBeGreaterThan(0);
  });

  it("ignores timestamps in the far future and the far past", () => {
    const conv: any = chatgptConversation();
    conv.mapping.u1.message.create_time = sec("2099-01-01T00:00:00Z");
    conv.mapping.a1.message.create_time = sec("1999-01-01T00:00:00Z");
    const [r] = parseChatGPT([conv], "b", NOW).records;
    expect(r.activityTimes.every((t) => t > at("2015-01-01T00:00:00Z") && t < at("2027-01-01T00:00:00Z"))).toBe(true);
  });

  it("handles a large export quickly (5,000 conversations, ~100 nodes each)", () => {
    const base = at("2025-01-01T00:00:00Z") / 1000;
    const big = Array.from({ length: 5000 }, (_, ci) => {
      const mapping: Record<string, unknown> = {};
      let parent: string | null = null;
      for (let i = 0; i < 100; i++) {
        const id = `n${i}`;
        mapping[id] = { id, parent, message: { author: { role: i % 2 ? "assistant" : "user" }, create_time: base + ci * 3600 + i * 20 } };
        parent = id;
      }
      return { id: `c${ci}`, mapping, current_node: "n99" };
    });
    const t0 = Date.now();
    const parsed = parseExport(big, "b", NOW)!;
    const ms = Date.now() - t0;
    expect(parsed.records).toHaveLength(5000);
    expect(ms).toBeLessThan(5000);
  });
});

describe("describeShape (error diagnostics)", () => {
  it("names the fields but never includes any values", async () => {
    const { describeShape } = await import("../src/parse");
    const s = describeShape([{ id: "SECRET-VALUE", title: "SECRET TITLE", tags: ["x"] }, { id: 2 }]);
    expect(s).toContain("a list of 2 items");
    expect(s).toContain("id, title, tags");
    expect(s).not.toContain("SECRET");
  });

  it("handles objects, empties and scalars", async () => {
    const { describeShape } = await import("../src/parse");
    expect(describeShape({ a: 1, b: "SECRET" })).toBe("an object with fields: a, b");
    expect(describeShape([])).toBe("an empty list");
    expect(describeShape("SECRET")).toBe("a string value");
    expect(describeShape([1, 2])).toContain("not objects");
  });
});

describe("detectManifest", () => {
  it("recognizes Claude's export manifest and names the conversations file", async () => {
    const { detectManifest } = await import("../src/parse");
    const manifest = { total_files: 2, data_files: [{ category: "projects", filename: "projects-000.zip" }, { category: "conversations", filename: "conversations-000.zip" }] };
    expect(detectManifest(manifest)).toEqual({ conversationsFile: "conversations-000.zip" });
    expect(detectManifest({ data_files: [] })).toEqual({ conversationsFile: null });
  });

  it("ignores everything else", async () => {
    const { detectManifest } = await import("../src/parse");
    expect(detectManifest([claudeConversation()])).toBeNull();
    expect(detectManifest(null)).toBeNull();
  });
});
