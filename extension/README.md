# extension/

Not built yet (phase 3).

An opt-in MV3 Chrome extension written in TypeScript that measures live active time on claude.ai and chatgpt.com and writes it to Supabase. Its sessions are `source: "extension"` with `confidence: "measured"`. It collects durations and counts only, never message text.

It will reuse `@trackhour/core` types and helpers.

## Discord Rich Presence

The extension is also the natural home for Discord Rich Presence ("Using Claude, 42 minutes"), since it already knows which tool is active. Presence would show the tool and elapsed time only, and would be opt-in.
