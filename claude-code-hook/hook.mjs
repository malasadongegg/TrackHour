#!/usr/bin/env node
/**
 * TrackHour Claude Code hook.
 *
 * One script handles the Claude Code hook events below (dispatched by
 * `hook_event_name` on stdin). All timing rules live in hook-core.mjs.
 *   SessionStart     -> the session began or resumed.
 *   UserPromptSubmit -> you sent a message.
 *   Stop             -> Claude finished replying.
 *   PostToolUse      -> (Edit/Write/MultiEdit/NotebookEdit) an edit ran: count lines changed.
 *   SessionEnd       -> finish: write this session's active stretches to the local
 *                       log file that TrackHour's web app imports, the same way
 *                       you'd import a ChatGPT or Claude export.
 *
 * PRIVACY: this never reads any code or prompt text. It reads only
 * `file_path` sizes (as line counts of the strings Claude Code itself already
 * sent it) and timestamps. Nothing leaves your machine; the log file is
 * something you drag into the TrackHour web app yourself when you want to.
 *
 * PERFORMANCE: SessionEnd hooks share roughly a 1.5 second total timeout
 * budget across every hook registered for that event, so this only ever
 * touches small local files, never the network.
 *
 * SAFETY: a hook must never crash or hang Claude Code. This script never
 * throws past main(), never writes to stdout (SessionStart and UserPromptSubmit
 * stdout is injected into Claude's own context, so anything printed there would
 * leak into your conversation), and always exits 0.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { belongsTo, buildSessions, linesForToolCall, newState, record, upgradeState } from "./hook-core.mjs";

const DIR = path.join(os.homedir(), ".trackhour");
const STATE_DIR = path.join(DIR, "state");
const LOG_FILE = path.join(DIR, "claude-code-sessions.json");
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

/** Load this session's state (upgrading an old-format file), or start one at `now`. */
function loadState(sessionId, now) {
  const saved = readJson(statePath(sessionId), null);
  return saved ? upgradeState(saved, now) : newState(now);
}

function onActivity(sessionId, kind, lines = 0) {
  const now = Date.now();
  // A hook can fire for a session we never saw start (hooks added mid-session): begin counting from now.
  const state = loadState(sessionId, now);
  record(state, kind, now, lines);
  writeJsonAtomic(statePath(sessionId), state);
}

function onSessionEnd(sessionId) {
  const saved = readJson(statePath(sessionId), null);
  if (!saved) return; // nothing measured for this session; nothing to report
  const now = Date.now();
  const sessions = buildSessions(upgradeState(saved, now), sessionId, now);

  const log = readJson(LOG_FILE, null) ?? { source: "trackhour-claude-code-hook", version: 1, sessions: [] };
  // Replace any earlier entries for this session rather than double counting, in case SessionEnd fires twice.
  log.sessions = log.sessions.filter((s) => !belongsTo(s?.externalRef, sessionId));
  log.sessions.push(...sessions);
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
  // The id becomes part of a file name, so anything that is not a plain id is ignored.
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(sessionId)) return;

  switch (event.hook_event_name) {
    case "SessionStart":
      onActivity(sessionId, "start");
      break;
    case "UserPromptSubmit":
      onActivity(sessionId, "prompt");
      break;
    case "Stop":
      onActivity(sessionId, "stop");
      break;
    case "PostToolUse":
      onActivity(sessionId, "tool", linesForToolCall(event.tool_name, event.tool_input));
      break;
    case "SessionEnd":
      onSessionEnd(sessionId);
      break;
  }
}

main().catch(() => {}); // a hook must never crash Claude Code, whatever goes wrong
