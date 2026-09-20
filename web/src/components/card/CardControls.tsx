import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CARD_STATS,
  CARD_STAT_KEYS,
  LAYOUT_VARIANTS,
  THEME_KEYS,
  THEME_PRESETS,
  TITLE_MAX,
  TOOL_KEYS,
  type CardColors,
  type CardConfig,
  type CardStatKey,
  type StatGroup,
  type ToolKey,
} from "@trackhour/core";
import { TOOL_META } from "../../lib/tools";

interface Props {
  config: CardConfig;
  toolsWithData: ToolKey[];
  onChange: (patch: Partial<CardConfig>) => void;
  onReset: () => void;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const GROUPS: StatGroup[] = ["Totals", "Sessions", "Habits", "Recent"];

/** <input type="color"> only understands #rrggbb. */
function toSixDigit(hex: string): string {
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 border-t border-line/60 pt-4 first:border-t-0 first:pt-0">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className={`flex items-center gap-2.5 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-line accent-[#66c0f4]"
      />
      <span className="text-ink">{children}</span>
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value);
  // While the field is being typed in, do not overwrite it from props. A partial entry such as "#ff0"
  // is already a valid 3 digit color, so applying it would otherwise reset the field mid-typing.
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  // Accept "ff00aa" as well as "#ff00aa", so pasting from anywhere works.
  const asHex = (raw: string) => (raw.startsWith("#") ? raw : `#${raw}`);
  const valid = HEX.test(asHex(text.trim()));
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="color"
        value={toSixDigit(value)}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${label} color picker`}
        className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent p-0.5"
      />
      <span className="w-24 text-sm text-ink">{label}</span>
      <input
        type="text"
        value={text}
        spellCheck={false}
        aria-label={`${label} hex value`}
        aria-invalid={!valid}
        onFocus={() => (editing.current = true)}
        onBlur={() => {
          editing.current = false;
          setText(value); // snap back to the last valid color if the entry was incomplete
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (HEX.test(asHex(e.target.value.trim()))) onChange(asHex(e.target.value.trim()));
        }}
        className={`num w-24 rounded border bg-bg px-2 py-1 text-sm text-white ${valid ? "border-line" : "border-danger"}`}
      />
    </div>
  );
}

export function CardControls({ config, toolsWithData, onChange, onReset }: Props) {
  const setColor = (key: keyof CardColors) => (hex: string) =>
    onChange({ theme: "custom", colors: { ...config.colors, [key]: hex } });

  const toggleStat = (key: CardStatKey, on: boolean) =>
    onChange({ stats: on ? [...config.stats, key] : config.stats.filter((k) => k !== key) });
  const toggleTool = (key: ToolKey, on: boolean) =>
    onChange({ tools: on ? [...config.tools, key] : config.tools.filter((k) => k !== key) });

  const drawnTools = config.tools.filter((k) => toolsWithData.includes(k)).length;

  return (
    <div className="space-y-5 rounded-lg border border-line bg-panel p-5">
      <Section title="Theme">
        <div className="grid grid-cols-2 gap-2">
          {THEME_KEYS.map((key) => {
            const t = THEME_PRESETS[key];
            const active = config.theme === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ theme: key, colors: t.colors })}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm ${
                  active ? "border-accent bg-raised text-white" : "border-line text-ink hover:border-muted"
                }`}
              >
                <span className="flex shrink-0" aria-hidden="true">
                  {[t.colors.background, t.colors.accent, t.colors.text].map((c, i) => (
                    <span key={i} className="-ml-1 h-4 w-4 rounded-full border border-white/20 first:ml-0" style={{ background: c }} />
                  ))}
                </span>
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
        {config.theme === "custom" && <p className="text-xs text-muted">Custom colors. Pick a theme to start over.</p>}
      </Section>

      <Section title="Colors">
        <ColorField label="Background" value={config.colors.background} onChange={setColor("background")} />
        <ColorField label="Text" value={config.colors.text} onChange={setColor("text")} />
        <ColorField label="Accent" value={config.colors.accent} onChange={setColor("accent")} />
        <ColorField label="Muted" value={config.colors.muted} onChange={setColor("muted")} />
      </Section>

      <Section title="Title">
        <input
          type="text"
          value={config.title}
          maxLength={TITLE_MAX}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="AI Playtime"
          aria-label="Card title"
          className="w-full rounded border border-line bg-bg px-3 py-2 text-sm text-white placeholder:text-muted"
        />
      </Section>

      <Section title="Layout">
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Layout">
          {LAYOUT_VARIANTS.map((layout) => (
            <button
              key={layout}
              type="button"
              aria-pressed={config.layout === layout}
              onClick={() => onChange({ layout })}
              className={`rounded-md border px-3 py-2 text-sm capitalize ${
                config.layout === layout ? "border-accent bg-raised text-white" : "border-line text-ink hover:border-muted"
              }`}
            >
              {layout}
            </button>
          ))}
        </div>
        <Check checked={config.showHeatmap} disabled={config.layout === "compact"} onChange={(v) => onChange({ showHeatmap: v })}>
          Contribution graph {config.layout === "compact" && <span className="text-muted">(not in compact)</span>}
        </Check>
      </Section>

      <Section title="Tools">
        {TOOL_KEYS.filter((k) => toolsWithData.includes(k)).map((k) => (
          <Check key={k} checked={config.tools.includes(k)} onChange={(v) => toggleTool(k, v)}>
            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: TOOL_META[k].color }} aria-hidden="true" />
            {TOOL_META[k].label}
          </Check>
        ))}
        <Check
          checked={config.showCombined}
          disabled={drawnTools < 2 || config.layout !== "detailed"}
          onChange={(v) => onChange({ showCombined: v })}
        >
          Combined panel{" "}
          {config.layout !== "detailed" ? (
            <span className="text-muted">(detailed layout only)</span>
          ) : (
            drawnTools < 2 && <span className="text-muted">(needs two tools)</span>
          )}
        </Check>
      </Section>

      <Section title="Stats">
        <div className="flex gap-3 text-xs">
          <button type="button" className="text-accent hover:underline" onClick={() => onChange({ stats: [...CARD_STAT_KEYS] })}>
            Select all
          </button>
          <button type="button" className="text-accent hover:underline" onClick={() => onChange({ stats: [] })}>
            Select none
          </button>
        </div>
        {GROUPS.map((group) => (
          <div key={group} className="space-y-2">
            <p className="text-xs text-muted">{group}</p>
            {CARD_STAT_KEYS.filter((k) => CARD_STATS[k].group === group).map((k) => (
              <Check key={k} checked={config.stats.includes(k)} onChange={(v) => toggleStat(k, v)}>
                {CARD_STATS[k].label}
              </Check>
            ))}
          </div>
        ))}
      </Section>

      <div className="space-y-2 border-t border-line/60 pt-4">
        <p className="text-xs text-muted">
          Cards built from imports always show an Estimated label. It cannot be turned off, so estimates are never passed off as measured time.
        </p>
        <button type="button" onClick={onReset} className="text-sm text-accent hover:underline">
          Reset card to defaults
        </button>
      </div>
    </div>
  );
}
