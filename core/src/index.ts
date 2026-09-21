// Explicit re-exports only, deliberately not `export * from`. See the comment
// at the top of core/src/card/index.ts for why: a star re-export compiles to
// a dynamic copy loop in the CommonJS build, which is invisible to the static
// analysis Vite and Node use to support named imports of a CJS package. Every
// name below must stay in sync with what each module actually exports; there
// is no way to enforce that automatically here, but a missing export shows up
// immediately as a build/runtime error wherever it's imported.
export { TOOL_KEYS } from "./types";
export type {
  ToolKey,
  Source,
  Confidence,
  Session,
  ConversationRecord,
  ImportBatch,
  SessionizeOptions,
  MessageCounts,
  ParseResult,
  ParsedExport,
  ImportPreview,
  StatsContext,
  DayBucket,
  MonthBucket,
  ToolStats,
} from "./types";

export { dayKey, startOfDay, nextDayStart, addDays, dayDiff, weekdayOf, startOfWeekKey, monthOf, yearOf } from "./dates";

export { WEEKDAYS, MONTHS_SHORT, MONTHS_LONG, fmtInt, fmtHours, fmtDuration, fmtDate, fmtDay, fmtMonth } from "./format";

export { makeIntensity } from "./heat";
export type { HeatLevel } from "./heat";

export { TOOL_LABELS, TOOL_COLORS, TOOL_HOSTS, BROWSER_TOOL_KEYS, ALL_TOOLS_COLOR } from "./tools";

export { DEFAULT_OPTIONS, resolveOptions, sessionize, combineSessions } from "./sessionize";

export { dailySeconds, dailyMinutes, monthlyHours, computeStreaks, computeStats } from "./stats";

export { recordKey, isRicher, dedupeRecords, buildPreview } from "./importing";

export {
  detectProvider,
  describeShape,
  detectManifest,
  parseChatGPT,
  parseClaude,
  isClaudeCodeLog,
  parseClaudeCodeLog,
  isExtensionLog,
  parseExtensionLog,
  parseExport,
} from "./parse";
export type { ParsedMeasuredSessions } from "./parse";

export {
  LAYOUT_VARIANTS,
  THEME_KEYS,
  CARD_STAT_KEYS,
  THEME_PRESETS,
  TITLE_MAX,
  DEFAULT_CARD_CONFIG,
  sanitizeTitle,
  displayTitle,
  normalizeCardConfig,
  CARD_STATS,
  buildCardData,
  AGGREGATE_DAYS,
  toAggregates,
  CARD_WIDTH,
  renderCard,
} from "./card";
export type { LayoutVariant, ThemeKey, CardStatKey, CardColors, CardConfig, CardData, ProfileAggregates, StatGroup, CardStatDef } from "./card";
