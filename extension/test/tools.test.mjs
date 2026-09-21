import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { TOOLS, toolForUrl } from "../src/tools.js";

// core is compiled to CommonJS in core/dist (pnpm build:libs runs before tests).
const core = createRequire(import.meta.url)("../../core/dist/index.js");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("the extension's tool list matches core's registry: keys, labels and hosts", () => {
  assert.deepEqual(TOOLS.map((t) => t.key).sort(), [...core.BROWSER_TOOL_KEYS].sort());
  for (const t of TOOLS) {
    assert.equal(t.label, core.TOOL_LABELS[t.key], `label for ${t.key}`);
    assert.deepEqual([...t.hosts].sort(), [...core.TOOL_HOSTS[t.key]].sort(), `hosts for ${t.key}`);
  }
});

test("the manifest's tracker script matches exactly the registered hosts, over https", () => {
  const tracker = manifest.content_scripts.find((c) => c.js.includes("src/content-tracker.js"));
  const expected = TOOLS.flatMap((t) => t.hosts.map((h) => `https://${h}/*`)).sort();
  assert.deepEqual([...tracker.matches].sort(), expected);
});

test("the site bridge is not injected into any tracked AI site, and the tracker not on the TrackHour site", () => {
  const bridge = manifest.content_scripts.find((c) => c.js.includes("src/content-bridge.js"));
  const tracker = manifest.content_scripts.find((c) => c.js.includes("src/content-tracker.js"));
  for (const m of bridge.matches) assert.ok(!tracker.matches.includes(m), m);
});

test("the extension asks for no permission beyond storage", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
});

test("toolForUrl maps real hosts and rejects lookalikes, other schemes and junk", () => {
  assert.equal(toolForUrl("https://claude.ai/chat/abc"), "claude");
  assert.equal(toolForUrl("https://chatgpt.com/"), "chatgpt");
  assert.equal(toolForUrl("https://gemini.google.com/app"), "gemini");
  assert.equal(toolForUrl("https://www.perplexity.ai/search?q=x"), "perplexity");
  assert.equal(toolForUrl("https://perplexity.ai/"), "perplexity");
  assert.equal(toolForUrl("https://copilot.microsoft.com/chats"), "copilot");
  assert.equal(toolForUrl("https://grok.com/chat/1"), "grok");
  assert.equal(toolForUrl("https://chat.deepseek.com/a/chat/s/1"), "deepseek");

  assert.equal(toolForUrl("http://claude.ai/"), null); // not https
  assert.equal(toolForUrl("https://claude.ai.evil.com/"), null); // lookalike suffix
  assert.equal(toolForUrl("https://evil.com/claude.ai"), null); // host in the path
  assert.equal(toolForUrl("https://notclaude.ai/"), null);
  assert.equal(toolForUrl("https://google.com/"), null);
  assert.equal(toolForUrl("not a url"), null);
  assert.equal(toolForUrl(undefined), null);
});
