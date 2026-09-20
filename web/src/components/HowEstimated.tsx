import type { SessionizeOptions } from "@trackhour/core";
import { DEFAULT_OPTIONS } from "@trackhour/core";

interface Props {
  options: SessionizeOptions;
  onChange: (options: SessionizeOptions) => void;
}

export function HowEstimated({ options, onChange }: Props) {
  const gapMin = options.inactivityGapMs / 60_000;
  const floorMin = options.minSessionMs / 60_000;

  const numberInput = (label: string, value: number, min: number, max: number, step: number, apply: (n: number) => void) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-ink">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min && n <= max) apply(n);
        }}
        className="num w-24 rounded border border-line bg-bg px-2 py-1 text-right text-white"
      />
    </label>
  );

  return (
    <details className="group rounded-lg border border-line bg-panel">
      <summary className="cursor-pointer select-none px-5 py-3 text-sm font-semibold text-white marker:text-muted">How hours are estimated</summary>
      <div className="space-y-4 border-t border-line px-5 py-4 text-sm leading-relaxed text-ink">
        <p>
          An export tells us when each message was sent. It does not tell us how long you were looking at the screen. So these hours are{" "}
          <strong className="text-white">estimates</strong>, and they are labeled that way everywhere.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>For each tool, every message timestamp from every conversation is put in one sorted list.</li>
          <li>
            A new session starts whenever the gap between two timestamps is longer than the inactivity limit (currently{" "}
            <span className="num">{gapMin}</span> minutes).
          </li>
          <li>A session lasts from its first timestamp to its last.</li>
          <li>
            A session with one message, or a very short one, is raised to a minimum (currently <span className="num">{floorMin}</span> minutes)
            so it never counts as zero.
          </li>
          <li>The estimated total is the sum of all session durations.</li>
        </ol>
        <div>
          <p className="font-semibold text-white">What this gets wrong</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            <li>Time spent reading the last reply is not counted, so it can undercount.</li>
            <li>A long pause shorter than the inactivity limit still counts as active, so it can overcount.</li>
            <li>Time in a tool without sending a message is invisible.</li>
            <li>Two tools used at the same time are counted in full for each. The combined total is the plain sum of the tool totals.</li>
            <li>
              For ChatGPT, message counts follow the branch you see. Edited and regenerated replies still add activity time but not
              message counts.
            </li>
            <li>A conversation that was already imported is skipped on re-import, even if a newer export has more messages in it.</li>
          </ul>
        </div>
        <div className="space-y-2 rounded-lg border border-line bg-bg/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">Adjust the estimate</p>
          {numberInput("Inactivity limit (minutes)", gapMin, 1, 240, 1, (n) => onChange({ ...options, inactivityGapMs: n * 60_000 }))}
          {numberInput("Minimum session (minutes)", floorMin, 0.5, 30, 0.5, (n) => onChange({ ...options, minSessionMs: n * 60_000 }))}
          <button
            type="button"
            onClick={() => onChange(DEFAULT_OPTIONS)}
            className="text-xs text-accent hover:underline"
          >
            Reset to defaults ({DEFAULT_OPTIONS.inactivityGapMs / 60_000} and {DEFAULT_OPTIONS.minSessionMs / 60_000} minutes)
          </button>
        </div>
      </div>
    </details>
  );
}
