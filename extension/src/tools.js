/**
 * The AI web apps this extension measures. This is a copy of TOOL_HOSTS,
 * TOOL_LABELS and BROWSER_TOOL_KEYS in core/src/tools.ts (the extension is not
 * bundled with core, so it cannot import them). extension/test/tools.test.mjs
 * fails if this list, that registry, or the manifest's content script matches
 * ever disagree.
 *
 * To add a tool: add it here, in core/src/tools.ts (plus TOOL_KEYS in
 * core/src/types.ts), and add `https://<host>/*` to the manifest's tracker
 * content script `matches`. The test tells you if you missed one.
 */
export const TOOLS = [
  { key: "chatgpt", label: "ChatGPT", hosts: ["chatgpt.com"] },
  { key: "claude", label: "Claude", hosts: ["claude.ai"] },
  { key: "gemini", label: "Gemini", hosts: ["gemini.google.com"] },
  { key: "perplexity", label: "Perplexity", hosts: ["www.perplexity.ai", "perplexity.ai"] },
  { key: "copilot", label: "Copilot", hosts: ["copilot.microsoft.com"] },
  { key: "grok", label: "Grok", hosts: ["grok.com"] },
  { key: "deepseek", label: "DeepSeek", hosts: ["chat.deepseek.com"] },
];

export const TOOL_KEYS = TOOLS.map((t) => t.key);

const KEY_BY_HOST = new Map(TOOLS.flatMap((t) => t.hosts.map((h) => [h, t.key])));

/**
 * Which tool a page URL belongs to, or null. The service worker decides this
 * from the sender's real URL, so a page cannot claim to be a different tool.
 * Exact hostname match over https only.
 */
export function toolForUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? (KEY_BY_HOST.get(u.hostname) ?? null) : null;
  } catch {
    return null;
  }
}
