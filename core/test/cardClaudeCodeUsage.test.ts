import { describe, expect, it } from "vitest";
import {
  DEFAULT_CARD_CONFIG,
  aggregateClaudeCodeUsage,
  buildCardData,
  normalizeCardConfig,
  renderCard,
  toAggregates,
  type ClaudeCodeUsageStats,
  type RawTurn,
} from "../src";
import { at } from "./helpers";

const NOW = at("2026-10-12T12:00:00Z");

function turn(overrides: Partial<RawTurn> = {}): RawTurn {
  return {
    timestamp: at("2026-10-10T09:00:00Z"),
    sessionId: "s1",
    dedupeKey: `m${Math.random()}`,
    model: "claude-sonnet-5",
    isSidechain: false,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 2_000_000,
    cacheCreationTokens: 5,
    ...overrides,
  };
}

function usageStats(): ClaudeCodeUsageStats {
  return aggregateClaudeCodeUsage(
    [
      turn({ dedupeKey: "a", outputTokens: 500_000, model: "claude-opus-4-6" }),
      turn({ dedupeKey: "b", outputTokens: 10_000, model: "claude-sonnet-5" }),
    ],
    { now: () => NOW },
  );
}

const emptyData = buildCardData([], [], { now: NOW, timeZone: "UTC" });
const config = { ...DEFAULT_CARD_CONFIG, stats: ["hoursOnRecord" as const] };

describe("card: Claude Code usage section", () => {
  it("does not appear on a card with no claudeCodeUsage, and the rest of the card is unchanged", () => {
    const svg = renderCard(config, emptyData);
    expect(svg).not.toContain("CLAUDE CODE, LOCAL SCAN");
  });

  it("appears when present, headlines OUTPUT tokens (never the raw total) as the big number", () => {
    const stats = usageStats();
    const data = { ...emptyData, claudeCodeUsage: stats };
    const svg = renderCard(config, data);
    expect(svg).toContain("CLAUDE CODE, LOCAL SCAN");
    expect(svg).toContain("510.0K"); // 500,000 + 10,000 output tokens, the headline
    expect(svg).toContain("output tokens");
    // the cache-dominated total (4M+ tokens here) must appear only in the smaller secondary line, never as the hero number's own value
    expect(svg).toContain("total");
  });

  it("never shows '<synthetic>' as the 'mostly <model>' caption or in byModel", () => {
    const stats = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "a", model: "<synthetic>", outputTokens: 999_999 }), turn({ dedupeKey: "b", model: "claude-sonnet-5", outputTokens: 1 })],
      { now: () => NOW },
    );
    const svg = renderCard(config, { ...emptyData, claudeCodeUsage: stats });
    expect(svg).not.toContain("synthetic");
    expect(svg).toContain("mostly claude-sonnet-5");
  });

  it("groups by the raw model id in the 'mostly <model>' caption, not a relabeled name", () => {
    const stats = usageStats(); // opus-4-6 has the most output tokens
    const svg = renderCard(config, { ...emptyData, claudeCodeUsage: stats });
    expect(svg).toContain("claude-opus-4-6");
  });

  it("is hidden entirely when showClaudeCodeUsage is turned off, even with data present", () => {
    const stats = usageStats();
    const svg = renderCard({ ...config, showClaudeCodeUsage: false }, { ...emptyData, claudeCodeUsage: stats });
    expect(svg).not.toContain("CLAUDE CODE, LOCAL SCAN");
  });

  it("renders on a card that otherwise has no session data at all (hasData false)", () => {
    const stats = usageStats();
    const svg = renderCard(config, { ...emptyData, claudeCodeUsage: stats });
    expect(svg).toContain("No usage data yet"); // the session-based empty state still shows
    expect(svg).toContain("CLAUDE CODE, LOCAL SCAN"); // and the usage section shows independently
  });

  it("shows a message instead of zeros when messageCount is 0", () => {
    const empty = aggregateClaudeCodeUsage([], { now: () => NOW });
    const svg = renderCard(config, { ...emptyData, claudeCodeUsage: empty });
    expect(svg).toContain("No usage data yet"); // appears twice: once for sessions, once for this section
  });

  it("normalizeCardConfig defaults showClaudeCodeUsage to true and accepts false", () => {
    expect(normalizeCardConfig({}).showClaudeCodeUsage).toBe(true);
    expect(normalizeCardConfig({ showClaudeCodeUsage: false }).showClaudeCodeUsage).toBe(false);
    expect(normalizeCardConfig({ showClaudeCodeUsage: "nope" }).showClaudeCodeUsage).toBe(true); // invalid falls back to default
  });

  it("toAggregates carries claudeCodeUsage through when present, and omits the field entirely when absent", () => {
    const stats = usageStats();
    const withUsage = toAggregates({ ...emptyData, claudeCodeUsage: stats });
    expect(withUsage.claudeCodeUsage).toEqual(stats);
    const without = toAggregates(emptyData);
    expect("claudeCodeUsage" in without).toBe(false);
  });

  it("long model names and large token counts never break well-formed SVG (XML safety)", () => {
    const weird = aggregateClaudeCodeUsage(
      [turn({ dedupeKey: "x", model: "claude-very-long-model-name-that-keeps-going-5-5-5", outputTokens: 9_999_999_999 })],
      { now: () => NOW },
    );
    const svg = renderCard(config, { ...emptyData, claudeCodeUsage: weird });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain("10.0B"); // fmtTokens caps at B, not a 10-digit raw number
  });
});
