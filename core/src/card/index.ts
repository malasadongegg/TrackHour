// Explicit re-exports only. TypeScript compiles `export * from` to a dynamic
// runtime copy loop in CommonJS output, which static CJS/ESM interop (Vite's
// dependency pre-bundling, Node's own named-import support for CJS packages)
// cannot always see through, silently breaking a downstream `import { X }
// from "@trackhour/core"` for names re-exported that way. Naming each export
// here compiles to a statically analyzable `Object.defineProperty(exports,
// "X", ...)` per name instead. See core/src/index.ts for the same reasoning.
export { LAYOUT_VARIANTS, THEME_KEYS, CARD_STAT_KEYS } from "./types";
export type { LayoutVariant, ThemeKey, CardStatKey, CardColors, CardConfig, CardData, ProfileAggregates } from "./types";
export { THEME_PRESETS } from "./themes";
export { TITLE_MAX, DEFAULT_CARD_CONFIG, sanitizeTitle, displayTitle, normalizeCardConfig } from "./config";
export { CARD_STATS } from "./stats";
export type { StatGroup, CardStatDef } from "./stats";
export { buildCardData, AGGREGATE_DAYS, toAggregates } from "./data";
export { CARD_WIDTH, renderCard } from "./render";
