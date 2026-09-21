import { useMemo, useState } from "react";
import { addDays, dayDiff, makeIntensity, startOfWeekKey, type DayBucket, type ToolStats } from "@trackhour/core";
import { fmtDay, fmtDuration, fmtHours, MONTHS_SHORT } from "../lib/format";
import { useWidth } from "../lib/useWidth";
import { TipLayer, useTip } from "./Tip";

interface Props {
  days: DayBucket[];
  color: string;
  today: string;
  confidence: ToolStats["confidence"];
}

const SOURCE_NOTE: Record<ToolStats["confidence"], string> = {
  estimated: "Estimated from message timestamps",
  measured: "Measured from active time",
  mixed: "Estimated and measured time",
  manual: "Entered by hand",
};

const GAP = 3;
const LEFT = 30;
const TOP = 18;
/** Share of the tool color mixed into the empty cell color, per intensity level 0..4. Single hue, light to strong. */
const LEVEL_PCT = [0, 28, 52, 76, 100];
const EMPTY = "rgba(255,255,255,0.06)";

const cellFill = (level: number, color: string) =>
  level === 0 ? EMPTY : `color-mix(in srgb, ${color} ${LEVEL_PCT[level]}%, #1e2d40)`;

/** GitHub style contribution graph. Weeks run Monday to Sunday, top to bottom. */
export function Heatmap({ days, color, today, confidence }: Props) {
  const { tip, show, hide } = useTip();
  const { ref: box, width: avail } = useWidth<HTMLDivElement>();
  const years = useMemo(() => [...new Set(days.map((d) => d.day.slice(0, 4)))].sort().reverse(), [days]);
  const [range, setRange] = useState("last12");
  const active = range === "last12" || years.includes(range) ? range : "last12";
  const minutesByDay = useMemo(() => new Map(days.map((d) => [d.day, d.minutes])), [days]);

  const grid = useMemo(() => {
    let rangeStart: string;
    let rangeEnd: string;
    if (active === "last12") {
      rangeEnd = today;
      rangeStart = addDays(today, -364);
    } else {
      rangeStart = `${active}-01-01`;
      rangeEnd = `${active}-12-31` > today ? today : `${active}-12-31`;
    }
    const firstWeek = startOfWeekKey(rangeStart);
    const cols = Math.floor(dayDiff(firstWeek, rangeEnd) / 7) + 1;

    const cells: Array<{ key: string; col: number; row: number; minutes: number }> = [];
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < 7; row++) {
        const key = addDays(firstWeek, col * 7 + row);
        if (key < rangeStart || key > rangeEnd) continue;
        cells.push({ key, col, row, minutes: minutesByDay.get(key) ?? 0 });
      }
    }

    // Same quartile shading as the SVG card (see core/src/heat.ts).
    const values = cells.filter((c) => c.minutes > 0).map((c) => c.minutes);
    const level = makeIntensity(values);

    const monthLabels: Array<{ col: number; text: string }> = [];
    for (let col = 0; col < cols; col++) {
      const monday = addDays(firstWeek, col * 7);
      if (Number(monday.slice(8)) <= 7 && monday >= rangeStart) {
        monthLabels.push({ col, text: MONTHS_SHORT[Number(monday.slice(5, 7)) - 1] });
      }
    }

    const totalMinutes = cells.reduce((sum, c) => sum + c.minutes, 0);
    const activeDays = values.length;
    return { cols, cells, level, monthLabels, totalMinutes, activeDays };
  }, [active, today, minutesByDay]);

  // Cells grow to fill the card (10 to 18px), like GitHub on a wide screen.
  const CELL = avail > 0 ? Math.max(10, Math.min(18, Math.floor((avail - LEFT) / grid.cols) - GAP)) : 11;
  const STEP = CELL + GAP;
  const width = LEFT + grid.cols * STEP;
  const height = TOP + 7 * STEP;
  const caption = active === "last12" ? "in the last 12 months" : `in ${active}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink">
          <span className="num font-semibold text-white">{fmtHours(grid.totalMinutes * 60)} hrs</span> {caption},{" "}
          <span className="num">{grid.activeDays}</span> active days
        </p>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Heatmap range">
          {["last12", ...years].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={active === r}
              className={`rounded px-2.5 py-1 text-xs ${active === r ? "bg-raised text-white" : "text-muted hover:text-ink"}`}
            >
              {r === "last12" ? "Last 12 months" : r}
            </button>
          ))}
        </div>
      </div>

      <div ref={box} className="overflow-x-auto pb-1">
        <svg width={width} height={height} role="img" aria-label={`Daily usage heatmap, ${fmtHours(grid.totalMinutes * 60)} hours ${caption}`} onMouseLeave={hide}>
          {grid.monthLabels.map((m) => (
            <text key={m.col} x={LEFT + m.col * STEP} y={11} fontSize="10" fill="#7f8f9f">
              {m.text}
            </text>
          ))}
          {[
            [0, "Mon"],
            [2, "Wed"],
            [4, "Fri"],
          ].map(([row, label]) => (
            <text key={label} x={0} y={TOP + (row as number) * STEP + CELL - 1} fontSize="10" fill="#7f8f9f">
              {label}
            </text>
          ))}
          {grid.cells.map((c) => (
            <rect
              key={c.key}
              x={LEFT + c.col * STEP}
              y={TOP + c.row * STEP}
              width={CELL}
              height={CELL}
              rx={2}
              style={{ fill: cellFill(grid.level(c.minutes), color) }}
              onMouseEnter={(e) => show(e, fmtDay(c.key), c.minutes > 0 ? `${fmtDuration(c.minutes * 60)} (est.)` : "No activity")}
              onMouseLeave={hide}
            />
          ))}
        </svg>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{SOURCE_NOTE[confidence]}</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="inline-block h-[11px] w-[11px] rounded-[2px]" style={{ background: cellFill(l, color) }} />
          ))}
          More
        </span>
      </div>
      <TipLayer tip={tip} />
    </div>
  );
}
