import { TOOL_KEYS, type ToolKey } from "../types";
import { THEME_PRESETS } from "./themes";
import {
  CARD_STAT_KEYS,
  LAYOUT_VARIANTS,
  THEME_KEYS,
  type CardColors,
  type CardConfig,
  type CardStatKey,
  type LayoutVariant,
  type ThemeKey,
} from "./types";

export const TITLE_MAX = 40;

export const DEFAULT_CARD_CONFIG: CardConfig = {
  version: 1,
  title: "AI Playtime",
  theme: "steam-slate",
  colors: THEME_PRESETS["steam-slate"].colors,
  layout: "showcase",
  tools: [...TOOL_KEYS],
  showCombined: true,
  stats: ["hoursOnRecord", "lastUsed", "sessions", "conversations", "messages", "avgSession", "currentStreak", "longestStreak"],
  showHeatmap: true,
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** C0 control characters are illegal in XML 1.0, whitespace controls become spaces. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITESPACE_CONTROL = /[\t\n\r]+/g;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Cleans a title for STORAGE. Deliberately does not trim or collapse spaces: this runs on every
 * keystroke of a controlled input, and trimming would swallow the space you just typed.
 */
export function sanitizeTitle(value: string): string {
  return value.replace(WHITESPACE_CONTROL, " ").replace(CONTROL, "").slice(0, TITLE_MAX);
}

/** The title as drawn: single spaces, no leading or trailing space. */
export function displayTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Picks members of `allowed` from `input`, unique, in canonical (`allowed`) order. Non-arrays yield the fallback. */
function pick<T extends string>(input: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(input)) return fallback;
  const wanted = new Set(input.filter((v): v is string => typeof v === "string"));
  return allowed.filter((k) => wanted.has(k));
}

/**
 * Turns UNTRUSTED input (IndexedDB, and later a URL query or database row) into
 * a valid CardConfig. Anything unknown is dropped, anything invalid falls back
 * to a default. Colors must be plain hex, which is what makes it impossible to
 * smuggle markup into the SVG through a color field.
 */
export function normalizeCardConfig(input: unknown): CardConfig {
  const src = isObj(input) ? input : {};
  const theme: ThemeKey | "custom" =
    src.theme === "custom" || (THEME_KEYS as readonly unknown[]).includes(src.theme)
      ? (src.theme as ThemeKey | "custom")
      : DEFAULT_CARD_CONFIG.theme;

  // Missing or invalid colors come from the chosen preset, so `{ theme: "github-dark" }` alone works.
  const base: CardColors = theme === "custom" ? DEFAULT_CARD_CONFIG.colors : THEME_PRESETS[theme].colors;
  const rawColors = isObj(src.colors) ? src.colors : {};
  const color = (key: keyof CardColors): string => {
    const v = rawColors[key];
    return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : base[key];
  };

  const layout: LayoutVariant = (LAYOUT_VARIANTS as readonly unknown[]).includes(src.layout)
    ? (src.layout as LayoutVariant)
    : DEFAULT_CARD_CONFIG.layout;

  return {
    version: 1,
    title: typeof src.title === "string" ? sanitizeTitle(src.title) : DEFAULT_CARD_CONFIG.title,
    theme,
    colors: { background: color("background"), text: color("text"), accent: color("accent"), muted: color("muted") },
    layout,
    tools: pick<ToolKey>(src.tools, TOOL_KEYS, [...DEFAULT_CARD_CONFIG.tools]),
    showCombined: typeof src.showCombined === "boolean" ? src.showCombined : DEFAULT_CARD_CONFIG.showCombined,
    stats: pick<CardStatKey>(src.stats, CARD_STAT_KEYS, [...DEFAULT_CARD_CONFIG.stats]),
    showHeatmap: typeof src.showHeatmap === "boolean" ? src.showHeatmap : DEFAULT_CARD_CONFIG.showHeatmap,
  };
}
