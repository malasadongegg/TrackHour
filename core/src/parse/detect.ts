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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A privacy-safe description of a JSON value's SHAPE for error messages:
 * container kind, size, and FIELD NAMES only. Never any value, so it can be
 * shown or shared without leaking content.
 */
export function describeShape(json: unknown): string {
  const names = (o: Record<string, unknown>) => {
    const keys = Object.keys(o);
    return keys.length === 0 ? "no fields" : `fields: ${keys.slice(0, 12).join(", ")}${keys.length > 12 ? ", ..." : ""}`;
  };
  if (Array.isArray(json)) {
    if (json.length === 0) return "an empty list";
    const first = json.find(isRecord);
    return first ? `a list of ${json.length} items; the first item has ${names(first)}` : `a list of ${json.length} items that are not objects`;
  }
  if (isRecord(json)) return `an object with ${names(json)}`;
  return `a ${typeof json} value`;
}
