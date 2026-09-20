import { ALL_TOOLS_COLOR, TOOL_COLORS, TOOL_KEYS, TOOL_LABELS, type ToolKey } from "@trackhour/core";

export const TOOL_META = Object.fromEntries(
  TOOL_KEYS.map((k) => [k, { label: TOOL_LABELS[k], color: TOOL_COLORS[k] }]),
) as Record<ToolKey, { label: string; color: string }>;

export const ALL_COLOR = ALL_TOOLS_COLOR;
