import type { ToolKey } from "../types";
import { isObj } from "./util";

/** Unwraps `[...]` or `{ conversations: [...] }` to the conversation array. */
export function conversationList(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json;
  if (isObj(json) && Array.isArray(json.conversations)) return json.conversations;
  return null;
}

/**
 * Items with a `mapping` field are ChatGPT. Items with `chat_messages` are
 * Claude. Looks at the first items only, so it stays cheap on huge exports.
 */
export function detectProvider(json: unknown): Extract<ToolKey, "chatgpt" | "claude"> | null {
  const list = conversationList(json);
  if (!list) return null;
  for (const item of list.slice(0, 50)) {
    if (!isObj(item)) continue;
    if ("mapping" in item) return "chatgpt";
    if ("chat_messages" in item) return "claude";
  }
  return null;
}
