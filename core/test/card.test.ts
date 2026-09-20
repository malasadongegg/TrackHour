import { describe, expect, it } from "vitest";
import {
  CARD_STAT_KEYS,
  CARD_WIDTH,
  DEFAULT_CARD_CONFIG,
  THEME_KEYS,
  THEME_PRESETS,
  buildCardData,
  fmtHours,
  normalizeCardConfig,
  renderCard,
  sessionize,
  type CardConfig,
  type Session,
} from "../src";
import { at, rec } from "./helpers";

const NOW = at("2026-03-11T12:00:00Z");
const ctx = { now: NOW, timeZone: "UTC" };

const records = [
  rec("chatgpt", [at("2026-03-02T09:00:00Z"), at("2026-03-02T09:10:00Z")], { externalRef: "a" }),
  rec("chatgpt", [at("2026-03-10T09:00:00Z"), at("2026-03-10T09:10:00Z")], { externalRef: "b" }),
  rec("claude", [at("2026-02-20T09:00:00Z"), at("2026-02-20T09:12:00Z")], { externalRef: "c" }),
];
const sessions: Session[] = [...sessionize(records, "chatgpt"), ...sessionize(records, "claude")];
const data = buildCardData(sessions, records, ctx);

const LAYOUTS = ["compact", "detailed", "showcase"] as const;

// Most tests exercise the detailed layout, which names each tool in its own panel.
const cfg = (over: Partial<CardConfig> = {}): CardConfig => ({ ...DEFAULT_CARD_CONFIG, layout: "detailed", ...over });
const render = (over: Partial<CardConfig> = {}, d = data) => renderCard(cfg(over), d);

/** Minimal XML well-formedness check: balanced tags and no bare ampersands. */
function expectWellFormed(svg: string) {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(svg))) {
    const [, close, name, , selfClosing] = m;
    if (selfClosing) continue;
    if (close) expect(stack.pop()).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
  expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
}

describe("renderCard output", () => {
  for (const layout of LAYOUTS) {
    it(`is a well-formed, fixed width SVG (${layout})`, () => {
      const svg = render({ layout });
      expect(svg.startsWith("<svg ")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).toContain(`width="${CARD_WIDTH}"`);
      expectWellFormed(svg);
    });
  }

  it("is fully self-contained: no external fonts, images, scripts or references", () => {
    for (const layout of LAYOUTS) {
      const svg = render({ layout });
      expect(svg).not.toMatch(/<image|<script|<foreignObject|<style|<link|@import|url\(|href=|xlink/i);
      // The only URL allowed is the SVG namespace itself.
      expect(svg.match(/https?:\/\/[^"'\s<]+/g)).toEqual(["http://www.w3.org/2000/svg"]);
      expect(svg).toContain("font-family=");
      expect(svg).toContain("-apple-system");
    }
  });

  it("is deterministic", () => {
    expect(render()).toBe(render());
  });

  it("uses the configured colors", () => {
    const colors = { background: "#010203", text: "#a1b2c3", accent: "#ff00aa", muted: "#334455" };
    const svg = render({ theme: "custom", colors });
    for (const c of Object.values(colors)) expect(svg).toContain(c);
  });
});

describe("renderCard security", () => {
  it("escapes the title", () => {
    const svg = render({ title: `<script>alert(1)</script> & "x" 'y'` });
    expect(svg).not.toContain("<script");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    expectWellFormed(svg);
  });

  it("cannot be injected through color fields", () => {
    const evil = '"/><script>alert(1)</script><rect fill="';
    const svg = renderCard(
      { ...DEFAULT_CARD_CONFIG, theme: "custom", colors: { background: evil, text: evil, accent: evil, muted: evil } },
      data,
    );
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("alert(1)");
    expectWellFormed(svg);
  });

  it("ignores unknown or hostile config values instead of trusting them", () => {
    const svg = renderCard({ ...DEFAULT_CARD_CONFIG, layout: "evil" as never, stats: ["nope", "sessions"] as never, tools: ["x"] as never }, data);
    expectWellFormed(svg);
  });
});

describe("renderCard content", () => {
  it("shows only the selected stats", () => {
    const svg = render({ stats: ["sessions", "longestStreak"], layout: "detailed" });
    expect(svg).toContain("Sessions");
    expect(svg).toContain("Longest streak");
    expect(svg).not.toContain("Conversations");
    expect(svg).not.toContain("hrs on record");
  });

  it("shows the hero hours and last used when selected", () => {
    const svg = render({ stats: ["hoursOnRecord", "lastUsed"], layout: "detailed" });
    expect(svg).toContain("hrs on record");
    expect(svg).toContain("last used Mar 10, 2026");
  });

  it("shows only the selected tools and computes the combined entry from just those", () => {
    const only = render({ tools: ["chatgpt"] }, buildCardData(sessions, records, ctx, ["chatgpt"]));
    expect(only).toContain("CHATGPT");
    expect(only).not.toContain("CLAUDE");
    expect(only).not.toContain("ALL TOOLS"); // a single tool needs no combined entry

    const both = render({ tools: ["chatgpt", "claude"] });
    expect(both).toContain("ALL TOOLS");
    expect(both).toContain("CLAUDE");
  });

  it("can hide the combined entry", () => {
    expect(render({ showCombined: false })).not.toContain("ALL TOOLS");
  });

  it("skips selected tools that have no data", () => {
    const svg = render({ tools: ["chatgpt", "claude_code"] }, buildCardData(sessions, records, ctx, ["chatgpt", "claude_code"]));
    expect(svg).not.toContain("CLAUDE CODE");
    expect(svg).toContain("CHATGPT");
  });

  it("always labels imported numbers as estimated, in every layout", () => {
    for (const layout of LAYOUTS) {
      const svg = render({ layout });
      expect(svg).toContain("ESTIMATED");
      if (layout !== "compact") expect(svg).toContain("Estimated from message timestamps");
    }
  });

  it("drops the estimated label only for measured data, and flags mixed data", () => {
    const measured = sessions.map((s) => ({ ...s, confidence: "measured" as const }));
    const measuredSvg = render({}, buildCardData(measured, records, ctx));
    expect(measuredSvg).not.toContain("ESTIMATED");

    const mixed = [...sessions, { ...sessions[0], id: "m", externalRef: "m", confidence: "measured" as const }];
    const mixedSvg = render({}, buildCardData(mixed, records, ctx));
    expect(mixedSvg).toContain("ESTIMATED + MEASURED");
  });

  it("shows an empty state when there is nothing to draw", () => {
    const empty = buildCardData([], [], ctx);
    const svg = render({}, empty);
    expect(svg).toContain("No usage data yet");
    expect(svg).not.toContain("ESTIMATED");
    expectWellFormed(svg);
  });

  it("truncates very long titles", () => {
    // The drawn text is cut to fit next to the estimated pill. The accessible <title> keeps the full text.
    expect(render({ title: "W".repeat(40) })).toMatch(/<text[^>]*>W{31}…<\/text>/);
  });

  it("omits the title text when the title is empty", () => {
    expectWellFormed(render({ title: "" }));
  });
});

describe("renderCard layouts", () => {
  const height = (svg: string) => Number(svg.match(/height="(\d+)"/)![1]);

  it("compact is a one-line badge: short, fixed height, one combined hero", () => {
    const svg = render({ layout: "compact", stats: ["hoursOnRecord", "sessions"] });
    expect(height(svg)).toBe(72);
    expect(svg).toContain("Claude"); // the per-tool split sits in the summary line
    expect(svg).toContain("ChatGPT");
    expect(height(render({ layout: "compact", stats: [...CARD_STAT_KEYS] }))).toBe(72); // more stats never grow it
  });

  it("compact is shorter than detailed and showcase", () => {
    expect(height(render({ layout: "compact" }))).toBeLessThan(height(render({ layout: "detailed" })));
    expect(height(render({ layout: "compact" }))).toBeLessThan(height(render({ layout: "showcase" })));
  });

  it("compact shows the combined hours of exactly the drawn tools", () => {
    const one = buildCardData(sessions, records, ctx, ["claude"]);
    const svg = render({ layout: "compact", tools: ["claude"] }, one);
    expect(svg).toContain(`>${fmtHours(one.all.totalSeconds)}<`);
  });

  it("showcase draws a big hero, a tool roster, and tiles for the other stats", () => {
    const svg = render({ layout: "showcase", stats: ["hoursOnRecord", "sessions", "messages", "longestStreak"], showHeatmap: false });
    expect(svg).toContain('font-size="56"');
    expect(svg).toContain("HOURS ON RECORD");
    expect(svg).toContain("ChatGPT");
    expect(svg).toContain("Claude");
    expect((svg.match(/rx="8"/g) ?? []).length).toBe(3); // sessions, messages, longest streak
    expectWellFormed(svg);
  });

  it("showcase shows the last used date in place of the roster for a single tool", () => {
    const one = buildCardData(sessions, records, ctx, ["chatgpt"]);
    const svg = render({ layout: "showcase", tools: ["chatgpt"], stats: ["hoursOnRecord", "lastUsed", "sessions"] }, one);
    expect(svg).toContain("LAST USED");
    expect(svg).toContain("Mar 10, 2026");
    expect((svg.match(/rx="8"/g) ?? []).length).toBe(1); // only sessions is left for a tile
  });

  it("showcase uses the first chosen stat as the hero when hours are not chosen", () => {
    const svg = render({ layout: "showcase", stats: ["sessions", "messages"], showHeatmap: false });
    expect(svg).toContain("SESSIONS");
    expect(svg).not.toContain("HOURS ON RECORD");
  });

  it("showcase grows with the number of tiles", () => {
    const few = render({ layout: "showcase", stats: ["hoursOnRecord", "sessions"], showHeatmap: false });
    const many = render({ layout: "showcase", stats: [...CARD_STAT_KEYS], showHeatmap: false });
    expect(height(many)).toBeGreaterThan(height(few));
  });

  it("detailed grows taller as more stats are selected", () => {
    const few = render({ layout: "detailed", stats: ["hoursOnRecord"], showHeatmap: false });
    const many = render({ layout: "detailed", stats: [...CARD_STAT_KEYS], showHeatmap: false });
    expect(height(many)).toBeGreaterThan(height(few));
  });

  it("draws the heatmap in detailed and showcase, only when enabled, never in compact", () => {
    const cells = (svg: string) => (svg.match(/width="11" height="11"/g) ?? []).length;
    for (const layout of ["detailed", "showcase"] as const) {
      expect(cells(render({ layout, showHeatmap: true }))).toBeGreaterThan(100);
      expect(cells(render({ layout, showHeatmap: false }))).toBe(0);
    }
    expect(cells(render({ layout: "compact", showHeatmap: true }))).toBe(0);
  });

  it("shades active days with more opacity than empty days", () => {
    const svg = render({ layout: "detailed", showHeatmap: true });
    expect(svg).toContain('fill-opacity="1"');
    expect(svg).toContain('fill-opacity="0.2"');
  });
});

describe("normalizeCardConfig", () => {
  it("returns defaults for garbage input", () => {
    expect(normalizeCardConfig(null)).toEqual(DEFAULT_CARD_CONFIG);
    expect(normalizeCardConfig("x")).toEqual(DEFAULT_CARD_CONFIG);
    expect(normalizeCardConfig([])).toEqual(DEFAULT_CARD_CONFIG);
  });

  it("fills missing colors from the chosen theme", () => {
    const c = normalizeCardConfig({ theme: "github-dark" });
    expect(c.colors).toEqual(THEME_PRESETS["github-dark"].colors);
  });

  it("keeps valid custom colors, lowercases them, and rejects invalid ones", () => {
    const c = normalizeCardConfig({ theme: "custom", colors: { background: "#ABCDEF", text: "red", accent: "#12", muted: "#fff" } });
    expect(c.colors.background).toBe("#abcdef");
    expect(c.colors.muted).toBe("#fff");
    expect(c.colors.text).toBe(DEFAULT_CARD_CONFIG.colors.text);
    expect(c.colors.accent).toBe(DEFAULT_CARD_CONFIG.colors.accent);
  });

  it("keeps tools and stats unique and in canonical order, dropping unknowns", () => {
    const c = normalizeCardConfig({ tools: ["claude", "nope", "chatgpt", "claude"], stats: ["sessions", "hoursOnRecord", "bogus"] });
    expect(c.tools).toEqual(["chatgpt", "claude"]);
    expect(c.stats).toEqual(["hoursOnRecord", "sessions"]);
  });

  it("allows an empty selection when it is explicit", () => {
    expect(normalizeCardConfig({ tools: [], stats: [] }).tools).toEqual([]);
  });

  it("clamps and cleans the title for storage without trimming what the user is typing", () => {
    expect(normalizeCardConfig({ title: "x".repeat(100) }).title).toHaveLength(40);
    const NUL = String.fromCharCode(0);
    expect(normalizeCardConfig({ title: `a
	b${NUL}c` }).title).toBe("a bc");
    expect(normalizeCardConfig({ title: "AI " }).title).toBe("AI "); // a trailing space must survive a keystroke
  });

  it("draws the title trimmed with single spaces", () => {
    expect(render({ title: "  A   B  " })).toMatch(/>A B<\/text>/);
  });

  it("accepts every layout variant and rejects unknown ones", () => {
    for (const layout of LAYOUTS) expect(normalizeCardConfig({ layout }).layout).toBe(layout);
    expect(normalizeCardConfig({ layout: "grid" }).layout).toBe(DEFAULT_CARD_CONFIG.layout);
  });

  it("is idempotent", () => {
    const once = normalizeCardConfig({ theme: "paper-light", title: "Me", layout: "compact" });
    expect(normalizeCardConfig(once)).toEqual(once);
  });
});

describe("theme presets", () => {
  it("ships five valid presets", () => {
    expect(THEME_KEYS).toHaveLength(5);
    for (const key of THEME_KEYS) {
      const { colors } = THEME_PRESETS[key];
      for (const value of Object.values(colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("renders every preset to a well-formed card", () => {
    for (const key of THEME_KEYS) expectWellFormed(render({ theme: key, colors: THEME_PRESETS[key].colors }));
  });
});
