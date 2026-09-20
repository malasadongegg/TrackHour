import type { CardColors, ThemeKey } from "./types";

export const THEME_PRESETS: Record<ThemeKey, { label: string; colors: CardColors }> = {
  "steam-slate": {
    label: "Steam Slate",
    colors: { background: "#1b2838", text: "#c7d5e0", accent: "#66c0f4", muted: "#8f98a0" },
  },
  "github-dark": {
    label: "GitHub Dark",
    colors: { background: "#0d1117", text: "#e6edf3", accent: "#39d353", muted: "#8b949e" },
  },
  "terminal-green": {
    label: "Terminal",
    colors: { background: "#0a0f0a", text: "#9dfb9d", accent: "#3dff6e", muted: "#5fa06f" },
  },
  "midnight-purple": {
    label: "Midnight",
    colors: { background: "#1a1330", text: "#e4dcff", accent: "#b388ff", muted: "#9489bd" },
  },
  "paper-light": {
    label: "Paper Light",
    colors: { background: "#f6f8fa", text: "#1f2328", accent: "#0969da", muted: "#59636e" },
  },
};
