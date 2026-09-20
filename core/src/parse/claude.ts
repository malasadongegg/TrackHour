/**
 * Claude (claude.ai) export parser.
 *
 * conversations.json is an array of conversations, each with a FLAT
 * `chat_messages` list: { uuid, sender: "human" | "assistant", text, created_at }.
 * There is no tree, so every message counts and every message with a valid
 * timestamp is activity. sender "human" maps to "user".
 */

import type { ConversationRecord, ParseResult } from "../types";
import { asString, ascending, isObj, isoToMs, type Obj } from "./util";

function roleOf(sender: unknown): "user" | "assistant" | null {
  if (sender === "human" || sender === "user") return "user";
  if (sender === "assistant") return "assistant";
  return null;
}

/**
 * A message's time. Newer exports may leave `created_at` off the message and
 * carry `start_timestamp` on the message or on its `content` blocks instead.
 */
function messageTime(msg: Obj, now: number): number | null {
  const direct = isoToMs(msg.created_at ?? msg.start_timestamp, now);
  if (direct !== null) return direct;
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (!isObj(block)) continue;
      const t = isoToMs(block.start_timestamp ?? block.stop_timestamp, now);
      if (t !== null) return t;
    }
  }
  return null;
}

export function parseClaude(json: unknown, importBatchId: string, now = Date.now()): ParseResult {
  const list = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.conversations) ? json.conversations : [];
  const records: ConversationRecord[] = [];
  let skipped = 0;

  for (const conv of list) {
    if (!isObj(conv) || !Array.isArray(conv.chat_messages)) {
      skipped++;
      continue;
    }
    const createdAt = isoToMs(conv.created_at, now);
    const updatedAt = isoToMs(conv.updated_at, now);
    const explicitRef = asString(conv.uuid) ?? asString(conv.id);

    const times: number[] = [];
    let userMessages = 0;
    let assistantMessages = 0;

    for (const msg of conv.chat_messages) {
      if (!isObj(msg)) continue;
      const role = roleOf(msg.sender);
      if (role === null) continue;
      if (role === "user") userMessages++;
      else assistantMessages++;
      const t = messageTime(msg, now);
      if (t !== null) times.push(t);
    }

    if (times.length === 0 && userMessages + assistantMessages === 0) {
      skipped++;
      continue;
    }

    // Messages exist but none had timestamps: fall back to the conversation
    // creation time as one point of activity. It is not a counted message time.
    const activityTimes = times.length === 0 && createdAt !== null ? [createdAt] : [...times];

    records.push({
      toolKey: "claude",
      // Fallback ref when the export has no id: derived from times only, never from the name.
      externalRef: explicitRef ?? `noid:${createdAt ?? activityTimes[0] ?? "?"}`,
      createdAt,
      updatedAt,
      activityTimes: activityTimes.sort(ascending),
      messageTimes: times.sort(ascending),
      userMessages,
      assistantMessages,
      importBatchId,
    });
  }

  return { records, skipped };
}
