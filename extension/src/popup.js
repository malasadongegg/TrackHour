import { TOOLS } from "./tools.js";

const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(chrome.runtime.lastError || !response || !response.ok ? null : response.result);
    });
  });
}

function fmt(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

async function refresh() {
  const status = await send({ type: "status" });
  if (!status) {
    $("state").textContent = "Could not reach the extension.";
    return;
  }
  $("state").textContent = status.paused ? "Paused" : "Tracking";
  $("state").className = status.paused ? "sub off" : "sub on";
  $("pause").textContent = status.paused ? "Resume tracking" : "Pause tracking";
  // Only tools with time on them, so the list stays short; the supported sites are listed below.
  const rows = $("rows");
  rows.replaceChildren();
  for (const tool of TOOLS) {
    if (!status.all[tool.key]) continue;
    const tr = document.createElement("tr");
    for (const text of [tool.label, fmt(status.today[tool.key]), fmt(status.all[tool.key])]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    rows.append(tr);
  }
  $("empty").hidden = rows.children.length > 0;
  $("sites").textContent = `Tracks: ${TOOLS.map((t) => t.label).join(", ")}.`;
  $("count").textContent = `${status.sessionCount} finished ${status.sessionCount === 1 ? "session" : "sessions"} stored on this computer.`;
  $("pause").onclick = async () => {
    await send({ type: "set-paused", paused: !status.paused });
    refresh();
  };
}

$("export").onclick = async () => {
  const log = await send({ type: "get-log" });
  if (!log) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(log)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "trackhour-extension-sessions.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$("clear").onclick = async () => {
  if (!confirm("Delete all time tracked by this extension? Sessions already imported into TrackHour are kept there.")) return;
  await send({ type: "clear" });
  refresh();
};

refresh();
