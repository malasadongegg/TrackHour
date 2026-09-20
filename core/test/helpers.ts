import type { ConversationRecord, ToolKey } from "../src/types";

export const MIN = 60_000;
export const HOUR = 3_600_000;

/** Epoch ms from an ISO string, so tests read as dates. */
export const at = (iso: string) => Date.parse(iso);

/** A conversation record whose every activity timestamp is also a counted message. */
export function rec(
  toolKey: ToolKey,
  times: number[],
  overrides: Partial<ConversationRecord> = {},
): ConversationRecord {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    toolKey,
    externalRef: overrides.externalRef ?? `c-${sorted[0]}`,
    createdAt: sorted[0] ?? null,
    updatedAt: sorted[sorted.length - 1] ?? null,
    activityTimes: sorted,
    messageTimes: sorted,
    userMessages: Math.ceil(sorted.length / 2),
    assistantMessages: Math.floor(sorted.length / 2),
    importBatchId: "batch-1",
    ...overrides,
  };
}
