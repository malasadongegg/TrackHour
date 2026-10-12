#!/usr/bin/env node
/**
 * TrackHour Claude Code TOKEN usage scanner.
 *
 * Reads Claude Code's own local transcripts in ~/.claude/projects/**\/*.jsonl ON
 * YOUR MACHINE and writes one small aggregate file
 * (~/.trackhour/claude-code-usage.json) that you paste or drop into TrackHour.
 * All the real work (dedupe, session boundaries, token totals) is the pure,
 * unit-tested aggregateClaudeCodeUsage in core/src/claudeCodeUsage.ts; this
 * script only walks files and picks the handful of fields it needs out of each
 * line.
 *
 * PRIVACY: this reads ONLY `type`, `timestamp`, `sessionId`, `isSidechain`,
 * `message.id`, `requestId`, `message.model` and `message.usage.*` from each
 * line. It never reads message content, prompts, tool input, file paths,
 * `cwd` or `gitBranch`. sessionId and the message/request id are used only to
 * dedupe multi-block turns and to bound sessions; by design, nothing the
 * aggregator returns (ClaudeCodeUsageStats) contains any session id, message
 * id, request id, uuid, machine id, hostname or path, and core's own tests
 * check this. Nothing here ever touches the network.
 *
 * This is a separate, sibling script to backfill.mjs, which already estimates
 * past Claude Code HOURS from these same files. This script reports TOKENS and
 * MODELS instead, a different metric with no time claim attached.
 *
 * Usage: node scan-usage.mjs [transcripts-dir] [output-file]
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
// core is compiled to CommonJS in core/dist (pnpm build:libs runs before this normally; run it
// yourself first if this fails with "Cannot find module").
const { aggregateClaudeCodeUsage } = require("../core/dist/index.js");

const transcriptsDir = process.argv[2] ?? path.join(os.homedir(), ".claude", "projects");
const outFile = process.argv[3] ?? path.join(os.homedir(), ".trackhour", "claude-code-usage.json");

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

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const turns = [];
/** Sanity check ONLY: Claude Code's own periodic per-session cost snapshot. Never used as a data source, never written to the output file. */
const costStateBySession = new Map();

let files = 0;
let assistantLines = 0;
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
    if (r?.type === "cost-state" && typeof r.sessionId === "string" && r.modelUsage && typeof r.modelUsage === "object") {
      costStateBySession.set(r.sessionId, r.modelUsage); // last one per session wins, as the file is append-only in time order
      continue;
    }
    if (r?.type !== "assistant") continue;
    const t = Date.parse(r.timestamp);
    if (!Number.isFinite(t)) continue;
    const msg = r.message && typeof r.message === "object" ? r.message : {};
    const usage = msg.usage && typeof msg.usage === "object" ? msg.usage : {};
    assistantLines++;
    turns.push({
      timestamp: t,
      sessionId: typeof r.sessionId === "string" ? r.sessionId : "",
      dedupeKey: typeof msg.id === "string" && msg.id ? msg.id : typeof r.requestId === "string" ? r.requestId : "",
      model: typeof msg.model === "string" ? msg.model : "",
      isSidechain: r.isSidechain === true,
      inputTokens: num(usage.input_tokens),
      outputTokens: num(usage.output_tokens),
      cacheReadTokens: num(usage.cache_read_input_tokens),
      cacheCreationTokens: num(usage.cache_creation_input_tokens),
    });
  }
}

const stats = aggregateClaudeCodeUsage(turns);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ source: "trackhour-claude-code-usage", version: 1, stats }));

const fmtTok = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

console.log(`Read ${files} transcript files (${skippedLines} unreadable lines skipped).`);
console.log(`Raw assistant lines read: ${assistantLines}  ->  deduped messages counted: ${stats.messageCount}  (${assistantLines - stats.messageCount} lines were extra content blocks or streamed duplicates of an already-counted message)`);
console.log(`Output tokens: ${fmtTok(stats.usage.outputTokens)}  |  total tokens (incl. cache): ${fmtTok(stats.usage.totalTokens)}  |  cache reads: ${fmtTok(stats.usage.cacheReadTokens)} (${stats.usage.totalTokens ? ((stats.usage.cacheReadTokens / stats.usage.totalTokens) * 100).toFixed(1) : "0.0"}% of total)`);
console.log(`Sessions: ${stats.sessionCount}  |  Active days: ${stats.activeDays}  |  Sidechain (sub-agent) messages: ${stats.sidechainMessages} of ${stats.messageCount}`);
console.log("By model (output tokens):");
for (const [model, u] of Object.entries(stats.byModel).sort((a, b) => b[1].outputTokens - a[1].outputTokens)) {
  console.log(`  ${model.padEnd(28)} ${fmtTok(u.outputTokens).padStart(8)} output   ${fmtTok(u.totalTokens).padStart(8)} total`);
}

// Sanity check only: compare against Claude Code's own cost-state snapshots. Never used as a source.
const costByModel = new Map();
for (const modelUsage of costStateBySession.values()) {
  for (const [model, u] of Object.entries(modelUsage)) {
    if (!u || typeof u !== "object") continue;
    costByModel.set(model, (costByModel.get(model) ?? 0) + num(u.outputTokens));
  }
}
if (costByModel.size) {
  console.log("\nSanity check against Claude Code's own cost-state snapshots (reference only, not used as a data source):");
  const models = new Set([...costByModel.keys(), ...Object.keys(stats.byModel)]);
  for (const model of models) {
    const mine = stats.byModel[model]?.outputTokens ?? 0;
    const theirs = costByModel.get(model) ?? 0;
    const diff = mine - theirs;
    const pct = theirs ? ((diff / theirs) * 100).toFixed(1) : mine ? "n/a" : "0.0";
    console.log(`  ${model.padEnd(28)} mine ${fmtTok(mine).padStart(8)}   cost-state ${fmtTok(theirs).padStart(8)}   diff ${diff >= 0 ? "+" : ""}${fmtTok(Math.abs(diff))} (${pct}%)`);
  }
} else {
  console.log("\nNo cost-state snapshots found to sanity check against.");
}

console.log(`\nFile: ${outFile}`);
