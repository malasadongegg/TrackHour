import type { ParsedExport } from "../types";
import { parseChatGPT } from "./chatgpt";
import { parseClaude } from "./claude";
import { detectProvider } from "./detect";

export { detectProvider, describeShape, detectManifest } from "./detect";
export { parseChatGPT } from "./chatgpt";
export { parseClaude } from "./claude";
export { isClaudeCodeLog, parseClaudeCodeLog, type ParsedMeasuredSessions } from "./claudeCode";
export { isExtensionLog, parseExtensionLog } from "./extension";
export { isSaneSpan, MAX_SESSION_SPAN_MS } from "./util";

/**
 * Detects the provider and parses. Returns null if the JSON is not a
 * recognizable ChatGPT or Claude conversations export.
 */
export function parseExport(json: unknown, importBatchId: string, now = Date.now()): ParsedExport | null {
  const toolKey = detectProvider(json);
  if (toolKey === null) return null;
  const result = toolKey === "chatgpt" ? parseChatGPT(json, importBatchId, now) : parseClaude(json, importBatchId, now);
  return { toolKey, ...result };
}
