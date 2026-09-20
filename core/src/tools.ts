import type { ToolKey } from "./types";

export const TOOL_LABELS: Record<ToolKey, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  claude_code: "Claude Code",
};

/** Identity colors for the tools. Used for small dots and accents only. */
export const TOOL_COLORS: Record<ToolKey, string> = {
  chatgpt: "#10a37f",
  claude: "#d97757",
  claude_code: "#e6a15c",
};

/** Color for the combined "all tools" view. */
export const ALL_TOOLS_COLOR = "#66c0f4";
