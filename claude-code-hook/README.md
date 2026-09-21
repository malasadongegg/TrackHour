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

## How it combines with imports

If you've never imported Claude Code data any other way, this is simply additive. If a browser extension (a possible future addition) or another measured source ever reports the *same* days for a tool, TrackHour prefers the measured number over an estimate for those days and leaves everything earlier untouched — see `combineSessions` in `core/src/sessionize.ts`.

## Known limits

- No live sync: you re-drop the log file to update your dashboard/card, the same as re-importing an export.
- "Lines changed" is a length estimate, not a real line-by-line diff.
- If Claude Code is closed uncleanly (crash, force-quit) without a `SessionEnd` firing, that session is never recorded. It is not lost forever: the next `SessionStart` for a genuinely new session starts fresh, and the incomplete one is simply never logged.
