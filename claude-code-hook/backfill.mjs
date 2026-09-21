#!/usr/bin/env node
/**
 * TrackHour Claude Code history backfill.
 *
 * Claude Code keeps a local transcript of every session in
 * ~/.claude/projects/<project>/*.jsonl. This script reads those files ON YOUR
 * MACHINE and writes one small file of estimated sessions
 * (~/.trackhour/claude-code-history.json) that you drag into TrackHour.
 *
 * PRIVACY: the transcripts contain your full prompts, replies and code. This
 * script uses them only to read timestamps, to tell a typed prompt from a tool
 * result, and to count the lines in edit tool calls. The output file contains
 * numbers and a generated id per session, never any text from a transcript.
 * Nothing is sent anywhere.
 *
 * OLDER HISTORY: Claude Code deletes old transcripts, but its prompt log
 * (~/.claude/history.jsonl) often reaches further back. Its timestamps (never
 * its text) fill in the time before the earliest transcript. Prompt-only
 * activity gives shorter sessions than a full transcript, so this part is a low
 * estimate.
 *
 * ESTIMATE: exactly like a ChatGPT or Claude import, only message times exist,
 * so a session is a run of activity with no gap over 15 minutes, and a session
 * is floored to 1 minute. Keep GAP_MS and MIN_SESSION_MS in sync with
 * core/src/sessionize.ts DEFAULT_OPTIONS. Everything here is labeled
 * "estimated"; time the live hook measured replaces it automatically.
 *
 * Usage: node backfill.mjs [transcripts-dir] [output-file]
 */
import fs from "fs";
import os from "os";
import path from "path";

const GAP_MS = 15 * 60_000;
const MIN_SESSION_MS = 60_000;

const transcriptsDir = process.argv[2] ?? path.join(os.homedir(), ".claude", "projects");
const outFile = process.argv[3] ?? path.join(os.homedir(), ".trackhour", "claude-code-history.json");

function* jsonlFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonlFiles(full);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield full;
  }
}

const countLines = (s) => (typeof s === "string" && s.length > 0 ? s.split("\n").length : 0);
const editDelta = (a, b) => countLines(a) + countLines(b);

/** Same counting as hook.mjs, so history and live sessions measure "lines changed" the same way. */
function linesForToolCall(name, input) {
  if (!input || typeof input !== "object") return 0;
  switch (name) {
    case "Edit":
      return editDelta(input.old_string, input.new_string);
    case "Write":
      return countLines(input.content);
    case "MultiEdit":
      return Array.isArray(input.edits) ? input.edits.reduce((n, e) => n + editDelta(e?.old_string, e?.new_string), 0) : 0;
    case "NotebookEdit":
      return countLines(input.new_source);
    default:
      return 0;
  }
}

/** A real typed prompt: a user record that carries text, not just tool results being fed back. */
function isTypedPrompt(record) {
  if (record.isMeta) return false;
  const content = record.message?.content;
  if (typeof content === "string") return content.length > 0;
  return Array.isArray(content) && content.some((b) => b?.type === "text");
}

/** activity: every user/assistant timestamp. Each event is [time, promptCount, lines]. */
const events = [];
// Resumed sessions copy earlier history into a new file with the same record uuids; count each record once.
const seen = new Set();
let files = 0;
let skippedLines = 0;

for (const file of jsonlFiles(transcriptsDir)) {
  files++;
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }
    if (r?.type !== "user" && r?.type !== "assistant") continue;
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t)) continue;
    if (typeof r.uuid === "string") {
      if (seen.has(r.uuid)) continue;
      seen.add(r.uuid);
    }
    let prompts = 0;
    let lines = 0;
    if (r.type === "user") {
      prompts = isTypedPrompt(r) ? 1 : 0;
    } else if (Array.isArray(r.message?.content)) {
      for (const b of r.message.content) {
        if (b?.type === "tool_use") lines += linesForToolCall(b.name, b.input);
      }
    }
    events.push([t, prompts, lines]);
  }
}

events.sort((a, b) => a[0] - b[0]);

// Claude Code also keeps a global log of every prompt you typed (~/.claude/history.jsonl)
// that can reach back further than the transcripts do. Only its timestamps are used, and only
// for the time BEFORE the earliest transcript, so nothing is counted twice.
const promptLog = path.join(os.homedir(), ".claude", "history.jsonl");
const earliestTranscript = events.length ? events[0][0] : Infinity;
let olderPrompts = 0;
try {
  for (const line of fs.readFileSync(promptLog, "utf8").split("\n")) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof r?.timestamp === "number" && Number.isFinite(r.timestamp) && r.timestamp < earliestTranscript) {
      events.push([r.timestamp, 1, 0]);
      olderPrompts++;
    }
  }
} catch {
  // No prompt log on this machine; the transcripts alone are used.
}
events.sort((a, b) => a[0] - b[0]);

const sessions = [];
let i = 0;
while (i < events.length) {
  const start = events[i][0];
  let last = start;
  let messageCount = 0;
  let linesChanged = 0;
  while (i < events.length && events[i][0] - last <= GAP_MS) {
    last = events[i][0];
    messageCount += events[i][1];
    linesChanged += events[i][2];
    i++;
  }
  const durationMs = Math.max(last - start, MIN_SESSION_MS);
  const ref = `claude_code:${start}`;
  sessions.push({
    id: ref,
    toolKey: "claude_code",
    startedAt: start,
    endedAt: start + durationMs,
    activeSeconds: durationMs / 1000,
    messageCount,
    linesChanged,
    externalRef: ref,
  });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ source: "trackhour-claude-code-backfill", version: 1, sessions }));

const hours = sessions.reduce((n, s) => n + s.activeSeconds, 0) / 3600;
const days = new Set(sessions.map((s) => new Date(s.startedAt).toDateString())).size;
console.log(`Read ${files} transcript files (${skippedLines} unreadable lines skipped) and ${olderPrompts} older prompt timestamps.`);
console.log(`Wrote ${sessions.length} estimated sessions on ${days} days, about ${hours.toFixed(1)} hours.`);
if (sessions.length) {
  console.log(`From ${new Date(sessions[0].startedAt).toLocaleDateString()} to ${new Date(sessions[sessions.length - 1].endedAt).toLocaleDateString()}.`);
}
console.log(`File: ${outFile}`);
