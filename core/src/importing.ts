/**
 * Import helpers: dedup and the pre-commit preview. Pure, so the web app and a
 * later backfill-to-Supabase step share one definition of "new vs duplicate".
 */

import { resolveOptions, sessionize } from "./sessionize";
import type { ConversationRecord, ImportPreview, SessionizeOptions, ToolKey } from "./types";

/** Dedup and storage key. The same conversation must never be counted twice. */
export const recordKey = (r: Pick<ConversationRecord, "toolKey" | "externalRef">) => `${r.toolKey}:${r.externalRef}`;

/**
 * Splits `incoming` into conversations we have not seen and duplicates.
 * Duplicates include repeats inside `incoming` itself (first one wins).
 * A conversation that was already imported is skipped even if the new export
 * has more messages in it. That is the safe direction: no double counting.
 */
export function dedupeRecords(
  existing: ConversationRecord[],
  incoming: ConversationRecord[],
): { fresh: ConversationRecord[]; duplicates: ConversationRecord[] } {
  const seen = new Set(existing.map(recordKey));
  const fresh: ConversationRecord[] = [];
  const duplicates: ConversationRecord[] = [];
  for (const r of incoming) {
    const key = recordKey(r);
    if (seen.has(key)) {
      duplicates.push(r);
    } else {
      seen.add(key);
      fresh.push(r);
    }
  }
  return { fresh, duplicates };
}

/**
 * What committing `incoming` would add. Sessions and usage are computed over
 * the NEW conversations alone, so the preview matches what gets stored.
 */
export function buildPreview(
  toolKey: ToolKey,
  existing: ConversationRecord[],
  incoming: ConversationRecord[],
  skippedConversations = 0,
  opts?: Partial<SessionizeOptions>,
): ImportPreview {
  const { fresh, duplicates } = dedupeRecords(existing, incoming);
  const sessions = sessionize(fresh, toolKey, resolveOptions(opts));

  let earliest: number | null = null;
  let latest: number | null = null;
  let user = 0;
  let assistant = 0;
  for (const r of fresh) {
    user += r.userMessages;
    assistant += r.assistantMessages;
    if (r.activityTimes.length > 0) {
      const first = r.activityTimes[0];
      const last = r.activityTimes[r.activityTimes.length - 1];
      if (earliest === null || first < earliest) earliest = first;
      if (latest === null || last > latest) latest = last;
    }
  }

  return {
    toolKey,
    conversationsInFile: incoming.length,
    newConversations: fresh.length,
    duplicateConversations: duplicates.length,
    skippedConversations,
    earliest,
    latest,
    messages: { user, assistant, total: user + assistant },
    estimatedSessions: sessions.length,
    estimatedSeconds: sessions.reduce((sum, s) => sum + s.activeSeconds, 0),
  };
}
