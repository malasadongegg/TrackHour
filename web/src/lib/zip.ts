import JSZip from "jszip";

/**
 * ChatGPT exports name the file conversations.json, and newer large exports
 * shard it into conversations-000.json, conversations-001.json, and so on. The
 * file may also sit inside a dated subfolder.
 */
const CONVERSATION_FILE = /(^|\/)conversations(-\d+)?\.json$/i;

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

/**
 * Reads a dropped export (a ZIP or a raw conversations.json) into one parsed
 * JSON value. Runs entirely in the browser. Nothing is uploaded.
 */
export async function readExport(file: File): Promise<unknown> {
  if (file.name.toLowerCase().endsWith(".json")) {
    return parseJson(await file.text(), file.name);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("That file is not a ZIP or a JSON file I can read.");
  }

  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && !f.name.startsWith("__MACOSX/") && CONVERSATION_FILE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) throw new Error("No conversations.json was found inside this ZIP.");

  // Merge shards into one array. Plain loops, since spreading a huge array can overflow the stack.
  const merged: unknown[] = [];
  for (const entry of entries) {
    const parsed = parseJson(await entry.async("string"), entry.name);
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { conversations?: unknown }).conversations)
        ? (parsed as { conversations: unknown[] }).conversations
        : null;
    if (list === null) throw new Error(`${entry.name} does not contain a list of conversations.`);
    for (const item of list) merged.push(item);
  }
  return merged;
}
