import { useEffect, useRef, useState } from "react";
import type { MonthBucket, ToolStats } from "@trackhour/core";
import { fmtMonth, MONTHS_SHORT } from "../lib/format";
import { useWidth } from "../lib/useWidth";
import { TipLayer, useTip } from "./Tip";

interface Props {
  months: MonthBucket[];
  color: string;
  confidence: ToolStats["confidence"];
}

const NOUN: Record<ToolStats["confidence"], string> = { estimated: "Estimated", measured: "Measured", mixed: "Estimated and measured", manual: "Manual" };

const PLOT_H = 140;
const TOP = 22;
const BOTTOM = 22;
const LEFT = 8;

/** Rounded top corners, square base anchored on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function MonthlyBars({ months, color, confidence }: Props) {
  const noun = NOUN[confidence];
  const { tip, show, hide } = useTip();
  const { ref: box, width: avail } = useWidth<HTMLDivElement>();
  const [asTable, setAsTable] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Start scrolled to the most recent month.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [months, asTable]);

  if (months.length === 0) return <p className="text-sm text-muted">No usage yet.</p>;

  const max = Math.max(...months.map((m) => m.hours), 0.1);
  // Spread bars across the card (26 to 56px per month), but keep the bars themselves thin.
  const step = Math.min(56, Math.max(26, avail > 0 ? Math.floor((avail - LEFT) / months.length) : 26));
  const BAR = Math.min(28, Math.round(step * 0.65));
  const GAP = step - BAR;
  const width = LEFT + months.length * step;
  const height = TOP + PLOT_H + BOTTOM;
  const labelEvery = step >= 40 ? 1 : months.length > 24 ? 6 : months.length > 12 ? 3 : 1;

  return (
    <div ref={box}>
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>{noun} hours per month. Peak {max.toLocaleString("en-US", { maximumFractionDigits: 1 })} hrs.</span>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="rounded px-2 py-1 hover:text-ink" aria-pressed={asTable}>
          {asTable ? "Show chart" : "Show table"}
        </button>
      </div>

      {asTable ? (
        <div ref={scroller} className="max-h-64 overflow-y-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-raised text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Month</th>
                <th className="px-3 py-1.5 text-right font-medium">{noun} hours</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.month} className="border-t border-line/60">
                  <td className="px-3 py-1.5">{fmtMonth(m.month)}</td>
                  <td className="num px-3 py-1.5 text-right">{m.hours.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={scroller} className="overflow-x-auto">
          <svg width={width} height={height} role="img" aria-label={`${noun} hours per month`} onMouseLeave={hide}>
            <line x1={0} x2={width} y1={TOP + PLOT_H} y2={TOP + PLOT_H} stroke="#2a3f55" />
            {months.map((m, i) => {
              const h = m.hours > 0 ? Math.max(3, (m.hours / max) * PLOT_H) : 0;
              const x = LEFT + i * step;
              const isLabeled = i % labelEvery === 0;
              const [y, mm] = m.month.split("-");
              return (
                <g key={m.month}>
                  {h > 0 && <path d={barPath(x, TOP + PLOT_H - h, BAR, h)} style={{ fill: color }} />}
                  {isLabeled && (
                    <text x={x + BAR / 2} y={TOP + PLOT_H + 15} fontSize="10" textAnchor="middle" fill="#7f8f9f">
                      {MONTHS_SHORT[Number(mm) - 1]}
                      {mm === "01" || i === 0 ? ` '${y.slice(2)}` : ""}
                    </text>
                  )}
                  {/* Full-height hit target, wider than the visible bar. */}
                  <rect
                    x={x - GAP / 2}
                    y={0}
                    width={step}
                    height={TOP + PLOT_H}
                    fill="transparent"
                    onMouseEnter={(e) => show(e, fmtMonth(m.month), `${m.hours.toFixed(1)} hrs (est.)`)}
                    onMouseLeave={hide}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <TipLayer tip={tip} />
    </div>
  );
}
