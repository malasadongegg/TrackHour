#!/usr/bin/env node
/**
 * TrackHour Claude Code hook.
 *
 * One script handles three Claude Code hook events (dispatched by
 * `hook_event_name` on stdin):
 *   SessionStart -> record when this session began.
 *   PostToolUse  -> (Edit/Write/MultiEdit/NotebookEdit only) count lines
 *                   changed and interactions for the in-progress session.
 *   SessionEnd   -> finish the session and append it to the local log file
 *                   that TrackHour's web app imports, the same way you'd
 *                   import a ChatGPT or Claude export.
 *
 * PRIVACY: this never reads or writes any code or prompt text. It reads only
 * `file_path` sizes (as line counts of the strings Claude Code itself already
 * sent it) and timestamps. Nothing leaves your machine; the log file is
 * something you drag into the TrackHour web app yourself when you want to.
 *
 * PERFORMANCE: SessionEnd hooks share roughly a 1.5 second total timeout
 * budget across every hook registered for that event, so this only ever
 * touches small local files, never the network.
 *
 * SAFETY: a hook must never crash or hang Claude Code. This script never
 * throws past main(), never writes to stdout (SessionStart's stdout is
 * injected into Claude's own context as a system reminder, so anything
 * printed there would leak into your conversation), and always exits 0.
 */
import fs from "fs";
import os from "os";
import path from "path";

const DIR = path.join(os.homedir(), ".trackhour");
const STATE_DIR = path.join(DIR, "state");
const LOG_FILE = path.join(DIR, "claude-code-sessions.json");

/** Matches core/src/sessionize.ts's DEFAULT_OPTIONS.minSessionMs, so a code session floors the same way an imported one does. */
const MIN_SESSION_MS = 60_000;
/** Read timeout well under the tightest hook budget (SessionEnd), so a stuck pipe can never hang Claude Code. */
const STDIN_TIMEOUT_MS = 1000;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    const done = () => resolve(data);
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", done);
    process.stdin.on("error", done);
    setTimeout(done, STDIN_TIMEOUT_MS).unref?.();
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Write via a temp file + rename, so a hook run mid-write (or two overlapping runs) never corrupts the file. */
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

const statePath = (sessionId) => path.join(STATE_DIR, `${sessionId}.json`);
const countLines = (s) => (typeof s === "string" && s.length > 0 ? s.split("\n").length : 0);

/** Lines touched by one Edit-style change: old lines removed plus new lines added. Not a real diff, close enough for a total. */
const editDelta = (oldStr, newStr) => countLines(oldStr) + countLines(newStr);

function linesForToolCall(toolName, input) {
  if (!input || typeof input !== "object") return 0;
  switch (toolName) {
    case "Edit":
      return editDelta(input.old_string, input.new_string);
    case "Write":
      return countLines(input.content);
    case "MultiEdit":
      return Array.isArray(input.edits) ? input.edits.reduce((sum, e) => sum + editDelta(e?.old_string, e?.new_string), 0) : 0;
    case "NotebookEdit":
      return countLines(input.new_source);
    default:
      return 0;
  }
}

function onSessionStart(sessionId) {
  // Do not clobber an existing state file: SessionStart can fire again for the
  // same session_id on --resume or --continue, and we want the ORIGINAL start
  // time, not a reset one.
  if (readJson(statePath(sessionId), null)) return;
  writeJsonAtomic(statePath(sessionId), { startedAt: Date.now(), toolCalls: 0, linesChanged: 0 });
}

function onPostToolUse(sessionId, toolName, toolInput) {
  // A tool call can arrive before we have ever seen a SessionStart for this id
  // (for example, hooks added mid-session). Start counting from now rather
  // than dropping the data.
  const state = readJson(statePath(sessionId), null) ?? { startedAt: Date.now(), toolCalls: 0, linesChanged: 0 };
  state.toolCalls += 1;
  state.linesChanged += linesForToolCall(toolName, toolInput);
  writeJsonAtomic(statePath(sessionId), state);
}

function onSessionEnd(sessionId) {
  const state = readJson(statePath(sessionId), null);
  if (!state) return; // nothing measured for this session; nothing to report

  const durationMs = Math.max(MIN_SESSION_MS, Date.now() - state.startedAt);
  const session = {
    id: `claude_code:${sessionId}`,
    toolKey: "claude_code",
    startedAt: state.startedAt,
    endedAt: state.startedAt + durationMs,
    activeSeconds: durationMs / 1000,
    messageCount: state.toolCalls,
    linesChanged: state.linesChanged,
    source: "code_hook",
    confidence: "measured",
    importBatchId: null,
    externalRef: sessionId,
  };

  const log = readJson(LOG_FILE, null) ?? { source: "trackhour-claude-code-hook", version: 1, sessions: [] };
  // Dedup by session id: replace a prior entry rather than double count it,
  // in case SessionEnd ever fires twice for the same session.
  log.sessions = log.sessions.filter((s) => s?.externalRef !== sessionId);
  log.sessions.push(session);
  writeJsonAtomic(LOG_FILE, log);

  try {
    fs.unlinkSync(statePath(sessionId));
  } catch {
    // Already gone, or never existed. Either way, nothing left to clean up.
  }
}

async function main() {
  const raw = await readStdin();
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return; // no valid input; say nothing, exit clean
  }
  const sessionId = event?.session_id;
  if (typeof sessionId !== "string" || !sessionId) return;

  switch (event.hook_event_name) {
    case "SessionStart":
      onSessionStart(sessionId);
      break;
    case "PostToolUse":
      onPostToolUse(sessionId, event.tool_name, event.tool_input);
      break;
    case "SessionEnd":
      onSessionEnd(sessionId);
      break;
  }
}

main().catch(() => {}); // a hook must never crash Claude Code, whatever goes wrong
