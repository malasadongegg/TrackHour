/**
 * Runs on claude.ai and chatgpt.com. It answers one question, "is the user
 * actively here right now?", and nothing else.
 *
 * PRIVACY: it never reads the page. No text, no titles, no URLs beyond the
 * hostname used to pick the tool, no DOM queries. It listens for the FACT that
 * an input event happened (never which key or where) and sends the tool name.
 *
 * Active means all of: the tab is visible, this window has focus, and the user
 * did something (moved the mouse, pressed a key, scrolled, clicked, touched) in
 * the last ACTIVE_WINDOW_MS.
 */
(() => {
  /** Must match BEAT_MS in sessions.js. */
  const BEAT_MS = 10_000;
  /**
   * Long enough to cover reading a reply while nudging the page now and then,
   * short enough that walking away stops the clock. Beats keep flowing for this
   * long after the last touch, so each beat also reports how long ago that last
   * touch was, and the service worker ends the session at the last real input
   * instead of crediting this idle tail.
   */
  const ACTIVE_WINDOW_MS = 90_000;

  const tool = location.hostname === "claude.ai" ? "claude" : location.hostname === "chatgpt.com" ? "chatgpt" : null;
  if (!tool) return;

  let lastInput = 0;
  const touch = () => {
    lastInput = Date.now();
  };
  // Passive listeners, on the capture phase so page code cannot swallow them.
  for (const name of ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"]) {
    window.addEventListener(name, touch, { capture: true, passive: true });
  }

  const timer = setInterval(() => {
    if (document.visibilityState !== "visible" || !document.hasFocus()) return;
    if (Date.now() - lastInput > ACTIVE_WINDOW_MS) return;
    try {
      chrome.runtime.sendMessage({ type: "beat", tool, idleMs: Date.now() - lastInput }, () => void chrome.runtime.lastError);
    } catch {
      // The extension was reloaded or updated under this page; this script is orphaned, so stop.
      clearInterval(timer);
    }
  }, BEAT_MS);
})();
