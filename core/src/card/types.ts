import type { ClaudeCodeUsageStats } from "../claudeCodeUsage";
import type { DayBucket, ToolKey, ToolStats } from "../types";

export const LAYOUT_VARIANTS = ["compact", "detailed", "showcase"] as const;
/**
 * compact:   one-line badge (combined hours, tool breakdown)
 * detailed:  a panel per tool with a stat grid
 * showcase:  one big hero stat, tool roster, and stat tiles below
 */
export type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];

export const THEME_KEYS = ["steam-slate", "github-dark", "terminal-green", "midnight-purple", "paper-light"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

/** Every stat a card can show, in the canonical order they are drawn. */
export const CARD_STAT_KEYS = [
  "hoursOnRecord",
  "lastUsed",
  "firstUsed",
  "daysSinceFirstUse",
  "sessions",
  "conversations",
  "messages",
  "linesChanged",
  "avgSession",
  "longestSession",
  "currentStreak",
  "longestStreak",
  "mostActiveWeekday",
  "mostActiveMonth",
  "usageToday",
  "usageWeek",
  "usageMonth",
  "usageYear",
] as const;
export type CardStatKey = (typeof CARD_STAT_KEYS)[number];

/** Each value is "#rgb" or "#rrggbb". Nothing else is accepted, so a config can never inject markup. */
export interface CardColors {
  background: string;
  text: string;
  accent: string;
  muted: string;
}

export interface CardConfig {
  version: 1;
  /** Up to 40 characters. May be empty. */
  title: string;
  theme: ThemeKey | "custom";
  colors: CardColors;
  layout: LayoutVariant;
  tools: ToolKey[];
  /** Adds an "All tools" entry. Ignored when fewer than two tools are drawn. */
  showCombined: boolean;
  stats: CardStatKey[];
  /** Mini contribution graph. Detailed layout only. */
  showHeatmap: boolean;
  /** Drawn only when the profile actually has a scanned Claude Code usage snapshot. */
  showClaudeCodeUsage: boolean;
}

/**
 * Everything renderCard needs, precomputed. Build it with `buildCardData`.
 * Only tools that actually have data appear in `byTool`.
 */
export interface CardData {
  timeZone: string;
  /** Epoch ms. Drives the "Updated" date and the heatmap window. */
  generatedAt: number;
  /** Combined stats over exactly the tools the config selects. */
  all: ToolStats;
  byTool: Partial<Record<ToolKey, ToolStats>>;
  daysByTool: Partial<Record<ToolKey, DayBucket[]>>;
  /**
   * A local scan of Claude Code's own transcripts (claude-code-hook/scan-usage.mjs),
   * imported separately from session data. Token usage, not time, and entirely
   * unrelated to `all`/`byTool`: it is never summed into the combined hours, since
   * it describes the SAME Claude Code activity the `claude_code` tool already
   * reports in hours, just as tokens instead.
   */
  claudeCodeUsage?: ClaudeCodeUsageStats;
}

/**
 * What a saved profile holds server-side. AGGREGATES ONLY: per-tool stats and
 * per-day active minutes for the card's window. Mirrors the `aggregates` column
 * in supabase/migrations/0001_profiles.sql.
 */
export interface ProfileAggregates {
  timeZone: string;
  /** Epoch ms when these were computed. Shown on the card as "Updated". */
  updatedAt: number;
  all: ToolStats;
  byTool: Partial<Record<ToolKey, ToolStats>>;
  daysByTool: Partial<Record<ToolKey, DayBucket[]>>;
  claudeCodeUsage?: ClaudeCodeUsageStats;
}
