/**
 * renderCard: config + precomputed data in, one self-contained SVG string out.
 *
 * Guarantees, all covered by tests:
 *  - Pure and deterministic. No clock, no randomness, no IO.
 *  - Self-contained. Presentation attributes only (no <style>, no external
 *    fonts or images, no <image>, <script>, <foreignObject> or url() refs), and a
 *    system font stack, so it looks the same wherever it is embedded.
 *  - Safe with untrusted config. The config is re-normalized here, every string
 *    is XML-escaped, and colors can only be plain hex.
 *  - Honest. The card always says when its numbers are estimated. There is no
 *    config switch for that on purpose.
 *
 * Three layouts share one 495px width and a height computed from the content:
 *  - compact:   a one-line badge (combined hours, tool breakdown)
 *  - detailed:  a panel per tool with a stat grid
 *  - showcase:  one big hero stat, a tool roster, and stat tiles below
 *
 * A pure function cannot measure fonts, so long text is truncated by an
 * estimated character budget instead.
 */

import { addDays, dayKey, startOfWeekKey } from "../dates";
import { fmtDate, fmtHours } from "../format";
import { makeIntensity } from "../heat";
import { TOOL_COLORS, TOOL_LABELS } from "../tools";
import { TOOL_KEYS, type Confidence, type DayBucket, type ToolKey, type ToolStats } from "../types";
import { displayTitle, normalizeCardConfig } from "./config";
import { CARD_STATS } from "./stats";
import type { CardColors, CardConfig, CardData, CardStatKey } from "./types";

export const CARD_WIDTH = 495;
const PAD = 24;
const INNER = CARD_WIDTH - PAD * 2;
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const HEAT_WEEKS = 30;
const HEAT_CELL = 11;
const HEAT_GAP = 3;
const HEAT_OPACITY = [0.2, 0.38, 0.58, 0.8, 1];

const num = (n: number) => String(Math.round(n * 100) / 100);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

interface TextOptions {
  size: number;
  fill: string;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  spacing?: number;
}

function text(x: number, y: number, content: string, o: TextOptions): string {
  const weight = o.weight ? ` font-weight="${o.weight}"` : "";
  const anchor = o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : "";
  const spacing = o.spacing ? ` letter-spacing="${o.spacing}"` : "";
  return `<text x="${num(x)}" y="${num(y)}" font-size="${o.size}"${weight}${anchor}${spacing} fill="${o.fill}">${esc(content)}</text>`;
}

function line(x1: number, y: number, x2: number, color: string, opacity: number): string {
  return `<line x1="${num(x1)}" y1="${num(y)}" x2="${num(x2)}" y2="${num(y)}" stroke="${color}" stroke-opacity="${opacity}"/>`;
}

type Shown = Exclude<Confidence | "mixed", "measured">;

const CONFIDENCE_LABEL: Record<Shown, string> = {
  estimated: "ESTIMATED",
  mixed: "ESTIMATED + MEASURED",
  manual: "MANUAL",
};

const FOOTNOTE: Partial<Record<Shown, string>> = {
  estimated: "Estimated from message timestamps",
  mixed: "Includes estimated and measured time",
};

/** Everything a layout needs, resolved once. */
interface Ctx {
  colors: CardColors;
  tz: string;
  data: CardData;
  selected: CardStatKey[];
  /** Drawn tools in canonical order (selected by config AND having data). */
  tools: ToolKey[];
  /** Label for the pill, or null for measured data. */
  pill: string | null;
  showHeatmap: boolean;
  showCombined: boolean;
}

function drawPill(body: string[], label: string, colors: CardColors, y: number): void {
  const w = Math.round(label.length * 6 + 18);
  const x = CARD_WIDTH - PAD - w;
  body.push(
    `<rect x="${x}" y="${y}" width="${w}" height="18" rx="9" fill="none" stroke="${colors.muted}" stroke-opacity="0.6"/>`,
    text(x + w / 2, y + 12.5, label, { size: 9, weight: 600, fill: colors.muted, anchor: "middle", spacing: 0.8 }),
  );
}

/** Merges per-tool day buckets into one series (minutes are summed per day). */
function mergeDays(series: DayBucket[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const days of series) for (const d of days) out.set(d.day, (out.get(d.day) ?? 0) + d.minutes);
  return out;
}

/** The stat that gets the big number: hours if chosen, otherwise the first chosen stat. */
function heroOf(selected: CardStatKey[]): CardStatKey | undefined {
  return selected.includes("hoursOnRecord") ? "hoursOnRecord" : selected[0];
}

export function renderCard(configInput: CardConfig, data: CardData): string {
  const config = normalizeCardConfig(configInput);
  const { colors } = config;

  const tools = TOOL_KEYS.filter((k) => config.tools.includes(k) && data.byTool[k]);
  const confidence = data.all.confidence;
  const hasData = tools.length > 0;
  const ctx: Ctx = {
    colors,
    tz: data.timeZone,
    data,
    selected: config.stats,
    tools,
    pill: hasData && confidence !== "measured" ? CONFIDENCE_LABEL[confidence] : null,
    showHeatmap: config.showHeatmap,
    showCombined: config.showCombined,
  };
  const title = displayTitle(config.title);
  const footnote = hasData && (confidence === "estimated" || confidence === "mixed") ? FOOTNOTE[confidence] ?? "" : "";

  const body: string[] = [];
  let height: number;

  if (hasData && config.layout === "compact") {
    height = drawCompact(body, ctx, title);
  } else {
    // Shared header for detailed, showcase and the empty state.
    if (title) body.push(text(PAD, 34, truncate(title, ctx.pill ? 32 : 40), { size: 16, weight: 600, fill: colors.text }));
    body.push(`<rect x="${PAD}" y="44" width="28" height="3" rx="1.5" fill="${colors.accent}"/>`);
    if (ctx.pill) drawPill(body, ctx.pill, colors, 20);

    let y = 66;
    if (!hasData) {
      body.push(text(CARD_WIDTH / 2, y + 26, "No usage data yet", { size: 13, fill: colors.muted, anchor: "middle" }));
      y += 56;
    } else if (config.layout === "showcase") {
      y = drawShowcase(body, ctx, y);
    } else {
      y = drawDetailed(body, ctx, y);
    }
    if (hasData && config.showHeatmap) y = drawHeatmap(body, tools.map((k) => data.daysByTool[k] ?? []), colors, data.generatedAt, data.timeZone, y);

    y += 6;
    if (footnote) body.push(text(PAD, y + 14, footnote, { size: 10, fill: colors.muted }));
    body.push(text(CARD_WIDTH - PAD, y + 14, `Updated ${fmtDate(data.generatedAt, data.timeZone)}`, { size: 10, fill: colors.muted, anchor: "end" }));
    height = y + 28;
  }

  const label = title || "AI usage";
  const summary = hasData
    ? `${label}: ${fmtHours(data.all.totalSeconds)} hours on record across ${tools.map((k) => TOOL_LABELS[k]).join(", ")}`
    : `${label}: no usage data yet`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${height}" viewBox="0 0 ${CARD_WIDTH} ${height}" role="img" font-family="${FONT}">`,
    `<title>${esc(summary)}</title>`,
    `<rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${height - 1}" rx="10" fill="${colors.background}" stroke="${colors.muted}" stroke-opacity="0.35"/>`,
    ...body,
    `</svg>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Compact: a one-line badge. Title and a short summary on the left, the
// combined hours as the hero on the right. Always the combined total over the
// drawn tools, with the per-tool split in the summary line.
// ---------------------------------------------------------------------------

const COMPACT_HEIGHT = 72;

function drawCompact(body: string[], c: Ctx, title: string): number {
  const { colors, tz, data, selected, tools } = c;
  const stats = data.all;
  const hero = heroOf(selected);

  if (c.pill) drawPill(body, c.pill, colors, 10);

  // Summary line: the split by tool when there are several, otherwise a couple of extra stats.
  let sub: string;
  if (tools.length > 1 && selected.includes("hoursOnRecord")) {
    // One line only fits about three tools; beyond that, name the two with the most hours and count the rest.
    const crowded = tools.length > 3;
    const shown = crowded ? [...tools].sort((a, b) => data.byTool[b]!.totalSeconds - data.byTool[a]!.totalSeconds).slice(0, 2) : tools;
    const parts = shown.map((k) => `${TOOL_LABELS[k]} ${fmtHours(data.byTool[k]!.totalSeconds)}h`);
    if (crowded) parts.push(`+${tools.length - shown.length} more`);
    sub = parts.join("  ·  ");
  } else {
    sub = selected.filter((k) => k !== hero).slice(0, 2).map((k) => CARD_STATS[k].phrase(stats, tz)).join("  ·  ");
  }

  const left = PAD + 16;
  body.push(`<circle cx="${PAD + 4}" cy="${title ? 25 : 37}" r="4" fill="${colors.accent}"/>`);
  if (title) body.push(text(left, 30, truncate(title, 24), { size: 14, weight: 600, fill: colors.text }));
  if (sub) body.push(text(left, title ? 51 : 41, truncate(sub, 50), { size: 11, fill: colors.muted }));

  if (hero) {
    const isHours = hero === "hoursOnRecord";
    const value = isHours ? fmtHours(stats.totalSeconds) : CARD_STATS[hero].value(stats, tz);
    const unit = isHours ? "hrs" : truncate(CARD_STATS[hero].label.toLowerCase(), 16);
    body.push(
      `<text x="${CARD_WIDTH - PAD}" y="58" text-anchor="end" font-size="${value.length > 8 ? 16 : 26}" font-weight="700" fill="${colors.text}">${esc(value)}` +
        `<tspan font-size="11" font-weight="400" fill="${colors.muted}" dx="5">${esc(unit)}</tspan></text>`,
    );
  }
  return COMPACT_HEIGHT;
}

// ---------------------------------------------------------------------------
// Detailed: a block per entity. Big "hrs on record" hero, "last used" under
// it, then the rest of the chosen stats in a 3 column grid.
// ---------------------------------------------------------------------------

const GRID_COLS = 3;
const GRID_ROW = 42;

function drawDetailed(body: string[], c: Ctx, top: number): number {
  const { colors, tz, data, selected, tools } = c;
  const entities: Array<{ name: string; dot: string; stats: ToolStats }> = [];
  if (c.showCombined && tools.length > 1) entities.push({ name: "All tools", dot: colors.accent, stats: data.all });
  for (const k of tools) entities.push({ name: TOOL_LABELS[k], dot: TOOL_COLORS[k], stats: data.byTool[k]! });

  const showHours = selected.includes("hoursOnRecord");
  const showLast = showHours && selected.includes("lastUsed");
  const grid = selected.filter((k) => k !== "hoursOnRecord" && !(showLast && k === "lastUsed"));
  const colWidth = INNER / GRID_COLS;

  let y = top;
  entities.forEach((e, i) => {
    if (i > 0) {
      body.push(line(PAD, y, CARD_WIDTH - PAD, colors.muted, 0.2));
      y += 16;
    }
    body.push(`<circle cx="${PAD + 4}" cy="${y + 7}" r="4" fill="${e.dot}"/>`);
    body.push(text(PAD + 16, y + 11, e.name.toUpperCase(), { size: 11, weight: 600, fill: colors.muted, spacing: 1.4 }));
    y += 24;

    if (showHours) {
      body.push(
        `<text x="${PAD}" y="${num(y + 34)}" font-size="38" font-weight="700" fill="${colors.text}">${esc(fmtHours(e.stats.totalSeconds))}` +
          `<tspan font-size="13" font-weight="400" fill="${colors.muted}" dx="8">hrs on record</tspan></text>`,
      );
      y += 44;
      if (showLast) {
        body.push(text(PAD, y + 10, `last used ${fmtDate(e.stats.lastUsed, tz)}`, { size: 12, fill: colors.text }));
        y += 24;
      } else {
        y += 6;
      }
    }

    grid.forEach((k, idx) => {
      const gx = PAD + (idx % GRID_COLS) * colWidth;
      const gy = y + Math.floor(idx / GRID_COLS) * GRID_ROW;
      body.push(text(gx, gy + 14, truncate(CARD_STATS[k].value(e.stats, tz), 16), { size: 15, weight: 600, fill: colors.text }));
      body.push(text(gx, gy + 28, truncate(CARD_STATS[k].label, 26), { size: 10, fill: colors.muted }));
    });
    y += Math.ceil(grid.length / GRID_COLS) * GRID_ROW;
    y += 4;
  });
  return y;
}

// ---------------------------------------------------------------------------
// Showcase: one giant hero number on the left with an accent bar, a roster of
// the tools on the right, and the other chosen stats as tiles underneath, like
// a player card. Always the combined total over the drawn tools.
// ---------------------------------------------------------------------------

const TILE_COLS = 3;
const TILE_GAP = 10;
const TILE_W = (INNER - TILE_GAP * (TILE_COLS - 1)) / TILE_COLS;
const TILE_H = 54;
const ROSTER_X = 300;
const ROSTER_LINES = 4;

function drawShowcase(body: string[], c: Ctx, top: number): number {
  const { colors, tz, data, selected, tools } = c;
  const stats = data.all;
  const hero = heroOf(selected);
  const isHours = hero === "hoursOnRecord";
  const consumed = new Set<CardStatKey>();
  let y = top;

  if (hero) {
    consumed.add(hero);
    const value = isHours ? fmtHours(stats.totalSeconds) : CARD_STATS[hero].value(stats, tz);
    const label = isHours ? "HOURS ON RECORD" : CARD_STATS[hero].label.toUpperCase();
    body.push(`<rect x="${PAD}" y="${y + 4}" width="4" height="72" rx="2" fill="${colors.accent}"/>`);
    body.push(text(PAD + 16, y + 52, value, { size: value.length > 8 ? 34 : 56, weight: 700, fill: colors.text }));
    body.push(text(PAD + 16, y + 72, truncate(label, 24), { size: 10, weight: 600, fill: colors.muted, spacing: 1.4 }));

    // Right column: the tool roster, or for a single tool the last used date.
    if (isHours && tools.length > 1) {
      // The block beside the hero fits four lines. With more tools, show the three with the most hours and "+N more".
      const crowded = tools.length > ROSTER_LINES;
      const shown = crowded ? [...tools].sort((a, b) => data.byTool[b]!.totalSeconds - data.byTool[a]!.totalSeconds).slice(0, ROSTER_LINES - 1) : tools;
      shown.forEach((k, i) => {
        const ry = y + 20 + i * 22;
        body.push(`<circle cx="${ROSTER_X + 4}" cy="${ry - 4}" r="4" fill="${TOOL_COLORS[k]}"/>`);
        body.push(text(ROSTER_X + 16, ry, TOOL_LABELS[k], { size: 11, fill: colors.muted }));
        body.push(text(CARD_WIDTH - PAD, ry, `${fmtHours(data.byTool[k]!.totalSeconds)}h`, { size: 13, weight: 600, fill: colors.text, anchor: "end" }));
      });
      if (crowded) {
        body.push(text(ROSTER_X + 16, y + 20 + shown.length * 22, `+${tools.length - shown.length} more`, { size: 11, fill: colors.muted }));
      }
    } else if (isHours && selected.includes("lastUsed")) {
      consumed.add("lastUsed");
      body.push(text(CARD_WIDTH - PAD, y + 34, "LAST USED", { size: 9, weight: 600, fill: colors.muted, anchor: "end", spacing: 1.2 }));
      body.push(text(CARD_WIDTH - PAD, y + 54, fmtDate(stats.lastUsed, tz), { size: 14, weight: 600, fill: colors.text, anchor: "end" }));
    }
    y += 92;
  }

  const tiles = selected.filter((k) => !consumed.has(k));
  tiles.forEach((k, idx) => {
    const tx = PAD + (idx % TILE_COLS) * (TILE_W + TILE_GAP);
    const ty = y + Math.floor(idx / TILE_COLS) * (TILE_H + TILE_GAP);
    body.push(`<rect x="${num(tx)}" y="${ty}" width="${num(TILE_W)}" height="${TILE_H}" rx="8" fill="${colors.muted}" fill-opacity="0.12"/>`);
    body.push(text(tx + 12, ty + 24, truncate(CARD_STATS[k].value(stats, tz), 15), { size: 14, weight: 700, fill: colors.text }));
    body.push(text(tx + 12, ty + 42, truncate(CARD_STATS[k].label, 22), { size: 10, fill: colors.muted }));
  });
  if (tiles.length) y += Math.ceil(tiles.length / TILE_COLS) * (TILE_H + TILE_GAP);
  return y;
}

// ---------------------------------------------------------------------------
// Mini contribution graph: the last 30 weeks, Monday first, summed over the
// tools that are drawn. Shading uses the accent color at rising opacity.
// ---------------------------------------------------------------------------

function drawHeatmap(body: string[], series: DayBucket[][], colors: CardColors, generatedAt: number, tz: string, top: number): number {
  const minutes = mergeDays(series);
  const today = dayKey(generatedAt, tz);
  const firstWeek = addDays(startOfWeekKey(today), -(HEAT_WEEKS - 1) * 7);

  const windowValues: number[] = [];
  for (let d = 0; d < HEAT_WEEKS * 7; d++) {
    const key = addDays(firstWeek, d);
    if (key > today) break;
    const m = minutes.get(key);
    if (m) windowValues.push(m);
  }
  const level = makeIntensity(windowValues);

  let y = top + 10;
  body.push(line(PAD, y - 8, CARD_WIDTH - PAD, colors.muted, 0.2));
  y += 8;
  body.push(text(PAD, y + 8, `Last ${HEAT_WEEKS} weeks`, { size: 10, fill: colors.muted }));
  y += 16;

  for (let col = 0; col < HEAT_WEEKS; col++) {
    for (let row = 0; row < 7; row++) {
      const key = addDays(firstWeek, col * 7 + row);
      if (key > today) continue;
      const l = level(minutes.get(key) ?? 0);
      const fill = l === 0 ? colors.muted : colors.accent;
      body.push(
        `<rect x="${PAD + col * (HEAT_CELL + HEAT_GAP)}" y="${y + row * (HEAT_CELL + HEAT_GAP)}" width="${HEAT_CELL}" height="${HEAT_CELL}" rx="2" fill="${fill}" fill-opacity="${HEAT_OPACITY[l]}"/>`,
      );
    }
  }
  return y + 7 * (HEAT_CELL + HEAT_GAP) + 2;
}
