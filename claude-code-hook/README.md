# claude-code-hook/

A Claude Code hook that measures your Claude Code session length and lines changed, entirely on your own machine, and writes them to a local file you import into the web app the same way you'd import a ChatGPT or Claude export.

## Privacy

- Runs only on your machine. Nothing it does ever touches the network.
- It never reads your code or your prompts. It only reads `file_path` and the *lengths* of the strings Claude Code itself already handed it (to estimate lines changed), plus timestamps and session ids.
- The result (`~/.trackhour/claude-code-sessions.json`) sits on your disk until you choose to drag it into the web app. Nothing is sent anywhere automatically.
- Sessions from this hook are labeled `confidence: "measured"`, never mixed silently with the estimated numbers from an import.

## What it measures

- **Session length**: from Claude Code's `SessionStart` event to its `SessionEnd` event. A session under a minute is floored to one minute, matching how imports floor short sessions.
- **Lines changed**: added and removed lines across `Edit`, `Write`, `MultiEdit` and `NotebookEdit` tool calls during the session. This is a length-based estimate (old lines plus new lines), not a real diff.
- **Interactions**: how many of those edit-tool calls happened, stored as the session's `messageCount`, since a coding session has no real "messages" to count.

## Setup

1. Note the absolute path to `hook.mjs` in this folder, for example:
   `C:/Users/you/Documents/Projects/TrackHour/claude-code-hook/hook.mjs`

2. Open (or create) `~/.claude/settings.json` — this applies the hook to every project, not just this repo. If you only want it for one project, use that project's `.claude/settings.json` instead.

3. Merge in this `hooks` block (merge, don't overwrite, if you already have other settings there):

   ```json
   {
     "hooks": {
       "SessionStart": [
         { "hooks": [{ "type": "command", "command": "node C:/absolute/path/to/hook.mjs", "async": true }] }
       ],
       "PostToolUse": [
         {
           "matcher": "Edit|Write|MultiEdit|NotebookEdit",
           "hooks": [{ "type": "command", "command": "node C:/absolute/path/to/hook.mjs", "async": true }]
         }
       ],
       "SessionEnd": [
         { "hooks": [{ "type": "command", "command": "node C:/absolute/path/to/hook.mjs" }] }
       ]
     }
   }
   ```

   Replace the path with your real one from step 1. `async: true` on `SessionStart` and `PostToolUse` means the hook never adds felt latency to your actual work; `SessionEnd` stays synchronous so its write reliably finishes before Claude Code exits.

4. Start a new Claude Code session. When it ends, check that `~/.trackhour/claude-code-sessions.json` was created.

5. In the TrackHour web app, drag that file onto the same dropzone you use for ChatGPT/Claude exports. It is detected automatically and imported as measured Claude Code sessions.

6. Repeat step 5 whenever you want your dashboard and card to catch up (there is no live sync yet; see below).

## Backfilling your past usage

The hook only sees sessions from the day you install it. Claude Code also keeps a local transcript of every session in `~/.claude/projects/`, so you can estimate your history from those:

```
node claude-code-hook/backfill.mjs
```

This writes `~/.trackhour/claude-code-history.json`. Drag it onto the TrackHour dropzone like any other file. It is labeled **Estimated**, exactly like a ChatGPT or Claude import: a session is a run of activity with no gap over 15 minutes.

- Privacy: the script reads your transcripts only on your machine, and the output holds numbers and generated ids, never any prompt, reply or code.
- Re-run it any time to pick up more history; already-imported sessions are updated, not duplicated.
- Claude Code deletes old transcripts after `cleanupPeriodDays` (default 30 days), so run this before history ages out, and consider raising that setting in `~/.claude/settings.json`.
- "Messages" for backfilled sessions counts your typed prompts, while hook sessions count file-edit tool calls, so the two are not directly comparable.
- Claude Code deletes old transcripts but often keeps its prompt log (`~/.claude/history.jsonl`) longer, so the script also uses that log's timestamps (never its text) for the time before your earliest transcript. That part is a low estimate, since it only sees your prompts.
- Where the live hook has measured a stretch of time, the measured session replaces the estimate for exactly that stretch; the rest of the day keeps its estimate.

## How it combines with imports

If you've never imported Claude Code data any other way, this is simply additive. If a browser extension (a possible future addition) or another measured source ever reports the *same* days for a tool, TrackHour prefers the measured number over an estimate for exactly the time it covers and leaves everything else untouched — see `combineSessions` in `core/src/sessionize.ts`.

## Known limits

- No live sync: you re-drop the log file to update your dashboard/card, the same as re-importing an export.
- "Lines changed" is a length estimate, not a real line-by-line diff.
- If Claude Code is closed uncleanly (crash, force-quit) without a `SessionEnd` firing, that session is never recorded. It is not lost forever: the next `SessionStart` for a genuinely new session starts fresh, and the incomplete one is simply never logged.
