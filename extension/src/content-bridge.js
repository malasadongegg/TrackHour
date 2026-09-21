/**
 * Runs ONLY on the TrackHour site (see the manifest's matches). It lets the
 * site ask this extension for the measured sessions, so they import
 * automatically instead of by dragging a file.
 *
 * Only a message posted by the page itself, to itself, is answered, and the
 * reply is posted back to the same origin only. The reply is the same log the
 * popup's Export button writes: tool names, start and end times, nothing else.
 */
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.source !== "trackhour-web" || data.type !== "request-log") return;
  try {
    chrome.runtime.sendMessage({ type: "get-log" }, (response) => {
      if (chrome.runtime.lastError || !response || !response.ok) return;
      window.postMessage({ source: "trackhour-extension", type: "log", log: response.result }, window.location.origin);
    });
  } catch {
    // Extension was reloaded under this page; nothing to answer with.
  }
});
