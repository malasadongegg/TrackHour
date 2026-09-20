import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  DEFAULT_OPTIONS,
  normalizeCardConfig,
  recordKey,
  type CardConfig,
  type ConversationRecord,
  type ImportBatch,
  type SessionizeOptions,
} from "@trackhour/core";

/**
 * Persistence. Everything lives in this browser's IndexedDB and never leaves it.
 * Only ConversationRecords and import batches are stored. Sessions and stats are
 * derived from them on every load.
 */

type StoredRecord = ConversationRecord & { key: string };

interface Schema extends DBSchema {
  records: { key: string; value: StoredRecord; indexes: { byBatch: string } };
  batches: { key: string; value: ImportBatch };
  settings: { key: string; value: SessionizeOptions | CardConfig };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db() {
  dbPromise ??= openDB<Schema>("trackhour", 2, {
    async upgrade(d, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const records = d.createObjectStore("records", { keyPath: "key" });
        records.createIndex("byBatch", "importBatchId");
        d.createObjectStore("batches", { keyPath: "id" });
        d.createObjectStore("settings");
      }
      if (oldVersion === 1) {
        // v1 stored each conversation's title. Only timestamps and counts are ever kept now, so drop them.
        let cursor = await tx.objectStore("records").openCursor();
        while (cursor) {
          if ("title" in cursor.value) {
            const { title: _title, ...rest } = cursor.value as StoredRecord & { title?: string };
            await cursor.update(rest);
          }
          cursor = await cursor.continue();
        }
      }
    },
  });
  return dbPromise;
}

export interface Library {
  records: ConversationRecord[];
  batches: ImportBatch[];
  options: SessionizeOptions;
  card: CardConfig;
}

export async function loadLibrary(): Promise<Library> {
  const d = await db();
  const [records, batches, options, card] = await Promise.all([
    d.getAll("records"),
    d.getAll("batches"),
    d.get("settings", "sessionize"),
    d.get("settings", "card"),
  ]);
  return {
    records,
    batches: batches.sort((a, b) => b.importedAt - a.importedAt),
    options: { ...DEFAULT_OPTIONS, ...(options as Partial<SessionizeOptions> | undefined) },
    // Stored data is untrusted input like any other: always normalize.
    card: normalizeCardConfig(card),
  };
}

/**
 * Writes a batch: brand new conversations are added, and `updated` ones REPLACE
 * the stored copy (same key, so nothing is double counted). Batch conversation
 * counts are then recomputed, and batches left with no conversations (every one
 * superseded by a newer export) are removed.
 */
export async function addImport(
  batch: ImportBatch,
  fresh: ConversationRecord[],
  updated: ConversationRecord[] = [],
): Promise<{ added: number; updated: number }> {
  const d = await db();
  const tx = d.transaction(["records", "batches"], "readwrite");
  const store = tx.objectStore("records");
  let added = 0;
  for (const r of fresh) {
    const key = recordKey(r);
    if (await store.get(key)) continue; // caller already deduped, never overwrite by accident
    await store.put({ ...r, key });
    added++;
  }
  let replaced = 0;
  for (const r of updated) {
    const key = recordKey(r);
    if (!(await store.get(key))) continue;
    await store.put({ ...r, key });
    replaced++;
  }
  if (added + replaced > 0) await tx.objectStore("batches").put({ ...batch, conversationCount: added + replaced });
  for (const b of await tx.objectStore("batches").getAll()) {
    const owned = (await store.index("byBatch").getAllKeys(b.id)).length;
    if (owned === 0) await tx.objectStore("batches").delete(b.id);
    else if (owned !== b.conversationCount) await tx.objectStore("batches").put({ ...b, conversationCount: owned });
  }
  await tx.done;
  return { added, updated: replaced };
}

export async function deleteBatch(batchId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["records", "batches"], "readwrite");
  const keys = await tx.objectStore("records").index("byBatch").getAllKeys(batchId);
  for (const key of keys) await tx.objectStore("records").delete(key);
  await tx.objectStore("batches").delete(batchId);
  await tx.done;
}

/** Deletes every import. Keeps the estimation and card settings. */
export async function wipeAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(["records", "batches"], "readwrite");
  await Promise.all([tx.objectStore("records").clear(), tx.objectStore("batches").clear()]);
  await tx.done;
}

export async function saveOptions(options: SessionizeOptions): Promise<void> {
  const d = await db();
  await d.put("settings", options, "sessionize");
}

export async function saveCard(card: CardConfig): Promise<void> {
  const d = await db();
  await d.put("settings", card, "card");
}

/** Asks the browser not to evict our data under storage pressure. Best effort. */
export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Not supported or denied. Data still persists normally.
  }
}
