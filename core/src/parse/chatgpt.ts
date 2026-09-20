/**
 * ChatGPT export parser.
 *
 * conversations.json is an array of conversations. Each has a `mapping`, an
 * object of nodeId -> node, and that mapping is a TREE, not a list: editing a
 * prompt or regenerating a reply forks a new branch and the old branch stays in
 * the file. So the two things we need are collected differently:
 *
 *  - ACTIVITY timestamps come from EVERY node that has a real create_time.
 *    Abandoned branches were still real usage at that moment.
 *  - MESSAGE counts come only from the branch you actually see: the path from
 *    `current_node` up through `parent` links. Counting every node would
 *    overcount edits and regenerations. If `current_node` is missing or does
 *    not resolve, we fall back to counting all user/assistant nodes.
 *
 * Only roles "user" and "assistant" count as messages. system and tool nodes
 * (and nodes flagged hidden) contribute activity timestamps but not counts.
 */

import type { ConversationRecord, ParseResult } from "../types";
import { asString, ascending, isObj, unixToMs, type Obj } from "./util";

function isCountedMessage(message: Obj): "user" | "assistant" | null {
  const author = isObj(message.author) ? message.author : null;
  const role = author?.role;
  if (role !== "user" && role !== "assistant") return null;
  const metadata = isObj(message.metadata) ? message.metadata : null;
  if (metadata?.is_visually_hidden_from_conversation === true) return null;
  return role;
}

/** Node ids on the visible branch, root side last. Cycle-safe. */
function visibleBranch(mapping: Obj, currentNode: unknown): Set<string> | null {
  if (typeof currentNode !== "string" || !isObj(mapping[currentNode])) return null;
  const seen = new Set<string>();
  let id: unknown = currentNode;
  while (typeof id === "string" && !seen.has(id)) {
    const node = mapping[id];
    if (!isObj(node)) break;
    seen.add(id);
    id = node.parent;
  }
  return seen;
}

export function parseChatGPT(json: unknown, importBatchId: string, now = Date.now()): ParseResult {
  const list = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.conversations) ? json.conversations : [];
  const records: ConversationRecord[] = [];
  let skipped = 0;

  for (const conv of list) {
    if (!isObj(conv) || !isObj(conv.mapping)) {
      skipped++;
      continue;
    }
    const mapping = conv.mapping;
    const createdAt = unixToMs(conv.create_time, now);
    const updatedAt = unixToMs(conv.update_time, now);
    const explicitRef = asString(conv.id) ?? asString(conv.conversation_id);

    const branch = visibleBranch(mapping, conv.current_node);
    const activityTimes: number[] = [];
    const messageTimes: number[] = [];
    let userMessages = 0;
    let assistantMessages = 0;

    for (const [nodeId, node] of Object.entries(mapping)) {
      if (!isObj(node) || !isObj(node.message)) continue;
      const message = node.message;
      const t = unixToMs(message.create_time, now);
      if (t !== null) activityTimes.push(t);

      const role = isCountedMessage(message);
      if (role === null) continue;
      if (branch !== null && !branch.has(nodeId)) continue;
      if (role === "user") userMessages++;
      else assistantMessages++;
      if (t !== null) messageTimes.push(t);
    }

    // Nothing usable at all: skip rather than store an empty shell.
    if (activityTimes.length === 0 && userMessages + assistantMessages === 0) {
      skipped++;
      continue;
    }
    // Messages exist but none had timestamps. The conversation still happened,
    // so record its creation time as a single point of activity.
    if (activityTimes.length === 0 && createdAt !== null) activityTimes.push(createdAt);

    records.push({
      toolKey: "chatgpt",
      // Fallback ref when the export has no id: derived from times only, never from the title.
      externalRef: explicitRef ?? `noid:${createdAt ?? activityTimes[0] ?? "?"}`,
      createdAt,
      updatedAt,
      activityTimes: activityTimes.sort(ascending),
      messageTimes: messageTimes.sort(ascending),
      userMessages,
      assistantMessages,
      importBatchId,
    });
  }

  return { records, skipped };
}
