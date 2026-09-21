const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(chrome.runtime.lastError || !response || !response.ok ? null : response.result);
    });
  });
}

function fmt(seconds) {
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
  for (const tool of ["claude", "chatgpt"]) {
    $(`${tool}-today`).textContent = fmt(status.today[tool]);
    $(`${tool}-all`).textContent = fmt(status.all[tool]);
  }
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
