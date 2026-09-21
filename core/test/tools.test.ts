import { describe, expect, it } from "vitest";
import { BROWSER_TOOL_KEYS, DEFAULT_CARD_CONFIG, TOOL_COLORS, TOOL_HOSTS, TOOL_KEYS, TOOL_LABELS, buildCardData, renderCard } from "../src";
import type { Session } from "../src";
import { at } from "./helpers";

describe("tool registry", () => {
  it("gives every tool a label, a color, and no duplicates", () => {
    expect(new Set(TOOL_KEYS).size).toBe(TOOL_KEYS.length);
    for (const k of TOOL_KEYS) {
      expect(TOOL_LABELS[k].length).toBeGreaterThan(0);
      expect(TOOL_COLORS[k]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // Colors are the only way to tell two tools apart in a chart, so none may repeat.
    expect(new Set(Object.values(TOOL_COLORS)).size).toBe(TOOL_KEYS.length);
    expect(new Set(Object.values(TOOL_LABELS)).size).toBe(TOOL_KEYS.length);
  });

  it("registers browser hosts as lowercase bare hostnames, each owned by one tool", () => {
    const seen = new Set<string>();
    for (const k of BROWSER_TOOL_KEYS) {
      for (const host of TOOL_HOSTS[k] ?? []) {
        expect(host).toMatch(/^[a-z0-9.-]+$/);
        expect(host).not.toMatch(/^https?:|\//);
        expect(seen.has(host)).toBe(false);
        seen.add(host);
      }
    }
  });

  it("only lists real tools as browser tools, and never Claude Code", () => {
    for (const k of BROWSER_TOOL_KEYS) expect(TOOL_KEYS).toContain(k);
    expect(BROWSER_TOOL_KEYS).not.toContain("claude_code");
  });
});

describe("a card with every tool", () => {
  const T = at("2026-03-10T09:00:00Z");
  const sessions: Session[] = TOOL_KEYS.map((k, i) => ({
    id: k,
    toolKey: k,
    startedAt: T,
    endedAt: T + (i + 1) * 3_600_000,
    activeSeconds: (i + 1) * 3600,
    messageCount: 1,
    source: "extension",
    confidence: "measured",
    importBatchId: null,
    externalRef: k,
  }));
  const ctx = { now: at("2026-03-12T12:00:00Z"), timeZone: "UTC" };
  const data = buildCardData(sessions, [], ctx);
  const config = { ...DEFAULT_CARD_CONFIG, stats: ["hoursOnRecord" as const, "sessions" as const] };

  it("showcase shows the tools with the most hours plus a +N more line instead of overflowing", () => {
    const svg = renderCard({ ...config, layout: "showcase" }, data);
    expect(svg).toContain(`+${TOOL_KEYS.length - 3} more`);
    // The tool with the most hours (last in the list here) is shown; the one with the fewest is folded into "more".
    expect(svg).toContain(TOOL_LABELS[TOOL_KEYS[TOOL_KEYS.length - 1]]);
    expect(svg).not.toContain(`>${TOOL_LABELS[TOOL_KEYS[0]]}<`);
  });

  it("showcase lists all tools with no +N line when they fit", () => {
    const four = TOOL_KEYS.slice(0, 4);
    const svg = renderCard({ ...config, layout: "showcase", tools: four }, buildCardData(sessions, [], ctx, four));
    expect(svg).not.toContain("more</text>");
    for (const k of four) expect(svg).toContain(TOOL_LABELS[k]);
  });

  it("compact names the two biggest tools and counts the rest instead of cutting a name off", () => {
    const svg = renderCard({ ...config, layout: "compact" }, data);
    expect(svg).toContain(`+${TOOL_KEYS.length - 2} more`);
    expect(svg).not.toContain("…");
  });

  it("detailed and compact still render every layout to valid SVG", () => {
    for (const layout of ["detailed", "compact"] as const) {
      const svg = renderCard({ ...config, layout }, data);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });
});
