# extension/

An opt-in Chrome extension (Manifest V3) that **measures** how long you are actively using claude.ai and chatgpt.com, so those hours are measured instead of estimated from an export. It works in Chrome, Edge, Brave and other Chromium browsers. Its sessions are `source: "extension"` with `confidence: "measured"`.

## Privacy

- It never reads the page. No message text, titles, URLs or page content. The page script only notes *that* an input event happened (never which key or where) and sends the tool name (`claude` or `chatgpt`).
- Everything is stored in `chrome.storage.local` on your computer. There is **no network code** in this extension, and it requests only the `storage` permission.
- Data leaves the extension in exactly two ways, both started by you: the popup's **Export file** button, or opening the TrackHour site, which asks the extension for its sessions (see below).
- The popup can pause tracking and delete everything the extension has stored.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose this `extension/` folder.
3. Use claude.ai or chatgpt.com as usual. Click the TrackHour toolbar icon to see today's time.
4. Open the TrackHour site. New sessions import automatically, with a banner saying so.

The extension talks to the TrackHour site at `https://trackhour-seven.vercel.app` and `http://localhost:5173` (see `matches` in `manifest.json`). If you deploy your own copy, add its address there.

## What counts as active time

Time counts only while **all** of these hold: the tab is visible, the browser window has focus, and you touched the page (mouse, keyboard, scroll, touch) within the last 90 seconds. While active, the page script sends a heartbeat every 10 seconds; heartbeats no more than 30 seconds apart belong to one session.

A session **ends at your last real input**, not at the last heartbeat, so the 90 second "recently active" window never adds idle time to your total. A run of heartbeats with no real input in it is dropped.

Known limits, so you can judge the numbers:

- Reading a long reply without touching the page for more than 90 seconds pauses the clock. Waiting on a long response the same way. This under-counts.
- Sessions split on every pause over about 90 seconds, so you will see more, shorter sessions than the 15 minute rule used for imports.
- Only this browser profile is measured. Other browsers, other computers and the mobile apps are not.
- Only time from the day you install it. Older history still comes from your exports.

## How it reaches the web app

`src/content-bridge.js` is injected only on the TrackHour site. When the app loads (and whenever its tab comes back into view) it posts a message to its own window asking for the log. The bridge answers with the finished sessions, and the app imports the new ones into your browser storage. A session is identified by its start time, so nothing is ever imported twice. Where the extension measured a stretch of time, that measurement replaces any imported estimate for exactly that stretch (see `combineSessions` in `core/src/sessionize.ts`).

## Files

- `src/content-tracker.js` runs on claude.ai and chatgpt.com and sends heartbeats.
- `src/sessions.js` turns heartbeats into sessions. Pure functions, unit tested.
- `src/background.js` service worker: the only code that writes stored data.
- `src/content-bridge.js` runs on the TrackHour site only.
- `src/popup.*` the toolbar popup.

Tests: `node --test extension/test/sessions.test.mjs` (also run by `pnpm test`).

## Discord Rich Presence

Not built. The extension is the natural home for it ("Using Claude, 42 minutes"), since it already knows which tool is active. Presence would show the tool and elapsed time only, and would be opt-in.
