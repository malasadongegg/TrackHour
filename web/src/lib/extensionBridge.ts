/**
 * Asks the TrackHour browser extension, if it is installed, for the sessions it
 * has measured. The extension injects a small script into this site only
 * (extension/src/content-bridge.js) that answers a same-window message.
 *
 * Resolves with the raw log, or null if nothing answered in time (extension not
 * installed, disabled, or this is a browser it does not run in). Nothing here
 * touches the network.
 */
export function requestExtensionLog(timeoutMs = 1500): Promise<unknown | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: unknown | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: unknown; type?: unknown; log?: unknown } | null;
      if (data && data.source === "trackhour-extension" && data.type === "log") finish(data.log ?? null);
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.postMessage({ source: "trackhour-web", type: "request-log" }, window.location.origin);
  });
}
