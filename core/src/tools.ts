import type { ToolKey } from "./types";

/**
 * THE tool registry. To add an AI tool: add its key to TOOL_KEYS in types.ts,
 * then a label, a color, and (if the browser extension can track it) its
 * hostnames below. The dashboard, charts and card pick it up from here. The
 * extension keeps its own copy of the hostnames (extension/src/tools.js) because
 * it is not bundled with this package; extension/test/tools.test.mjs fails if
 * the two ever disagree, and also checks the extension manifest.
 */
export const TOOL_LABELS: Record<ToolKey, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  claude_code: "Claude Code",
  gemini: "Gemini",
  perplexity: "Perplexity",
  copilot: "Copilot",
  grok: "Grok",
  deepseek: "DeepSeek",
};

/** Identity colors for the tools. Used for small dots and accents only, so each must be distinct. */
export const TOOL_COLORS: Record<ToolKey, string> = {
  chatgpt: "#10a37f",
  claude: "#d97757",
  claude_code: "#e6a15c",
  gemini: "#8ab4f8",
  perplexity: "#22b8cf",
  copilot: "#c084fc",
  grok: "#e5e7eb",
  deepseek: "#4d6bfe",
};

/**
 * Hostnames of the web apps the browser extension measures. A tool with no
 * entry here (Claude Code) is measured some other way or only imported.
 */
export const TOOL_HOSTS: Partial<Record<ToolKey, readonly string[]>> = {
  chatgpt: ["chatgpt.com"],
  claude: ["claude.ai"],
  gemini: ["gemini.google.com"],
  perplexity: ["www.perplexity.ai", "perplexity.ai"],
  copilot: ["copilot.microsoft.com"],
  grok: ["grok.com"],
  deepseek: ["chat.deepseek.com"],
};

/** Tools the extension can measure live. */
export const BROWSER_TOOL_KEYS: readonly ToolKey[] = (Object.keys(TOOL_HOSTS) as ToolKey[]).filter((k) => (TOOL_HOSTS[k]?.length ?? 0) > 0);

/** Color for the combined "all tools" view. */
export const ALL_TOOLS_COLOR = "#66c0f4";
