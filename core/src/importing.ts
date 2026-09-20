/**
 * Import helpers: dedup and the pre-commit preview. Pure, so the web app and a
 * later backfill-to-Supabase step share one definition of "new vs duplicate".
 */

import { resolveOptions, sessionize } from "./sessionize";
import type { ConversationRecord, ImportPreview, SessionizeOptions, ToolKey } from "./types";

/** Dedup and storage key. The same conversation must never be counted twice. */
export const recordKey = (r: Pick<ConversationRecord, "toolKey" | "externalRef">) => `${r.toolKey}:${r.externalRef}`;

/** How much a record knows. A newer export of the same conversation knows more. */
const lastActivity = (r: ConversationRecord) => r.activityTimes[r.activityTimes.length - 1] ?? 0;
const messageTotal = (r: ConversationRecord) => r.userMessages + r.assistantMessages;

/** True if `incoming` carries activity or messages the stored copy does not have. */
export function isRicher(incoming: ConversationRecord, stored: ConversationRecord): boolean {
  return (
    lastActivity(incoming) > lastActivity(stored) ||
    messageTotal(incoming) > messageTotal(stored) ||
    incoming.activityTimes.length > stored.activityTimes.length
  );
}

/**
 * Sorts `incoming` conversations against what is already stored:
 *  - fresh:     never seen before
 *  - updated:   seen before, but this copy has more (messages continued after
 *               the earlier export), so it REPLACES the stored one
 *  - unchanged: seen before and this copy has nothing new (including an older
 *               export imported after a newer one), so it is skipped
 * Repeats inside `incoming` collapse to the richest copy. Because a replacement
 * swaps the record instead of adding to it, nothing is ever counted twice.
 */
export function dedupeRecords(
  existing: ConversationRecord[],
  incoming: ConversationRecord[],
): { fresh: ConversationRecord[]; updated: ConversationRecord[]; unchanged: ConversationRecord[] } {
  const stored = new Map(existing.map((r) => [recordKey(r), r]));

  // Collapse repeats within the file to the richest copy (first wins on a tie).
  const best = new Map<string, ConversationRecord>();
  const repeats: ConversationRecord[] = [];
  for (const r of incoming) {
    const key = recordKey(r);
    const prev = best.get(key);
    if (!prev) best.set(key, r);
    else if (isRicher(r, prev)) {
      repeats.push(prev);
      best.set(key, r);
    } else repeats.push(r);
  }

  const fresh: ConversationRecord[] = [];
  const updated: ConversationRecord[] = [];
  const unchanged: ConversationRecord[] = [...repeats];
  for (const [key, r] of best) {
    const prior = stored.get(key);
    if (!prior) fresh.push(r);
    else if (isRicher(r, prior)) updated.push(r);
    else unchanged.push(r);
  }
  return { fresh, updated, unchanged };
}

/**
 * What committing `incoming` would change. Sessions, usage and message counts
 * are computed over the NEW and UPDATED conversations, so the preview matches
 * what gets written.
 */
export function buildPreview(
  toolKey: ToolKey,
  existing: ConversationRecord[],
  incoming: ConversationRecord[],
  skippedConversations = 0,
  opts?: Partial<SessionizeOptions>,
): ImportPreview {
  const { fresh, updated, unchanged } = dedupeRecords(existing, incoming);
  const touched = [...fresh, ...updated];
  const sessions = sessionize(touched, toolKey, resolveOptions(opts));

  let earliest: number | null = null;
  let latest: number | null = null;
  let user = 0;
  let assistant = 0;
  for (const r of touched) {
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
    updatedConversations: updated.length,
    unchangedConversations: unchanged.length,
    skippedConversations,
    earliest,
    latest,
    messages: { user, assistant, total: user + assistant },
    estimatedSessions: sessions.length,
    estimatedSeconds: sessions.reduce((sum, s) => sum + s.activeSeconds, 0),
  };
}
