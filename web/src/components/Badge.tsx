import type { Confidence } from "@trackhour/core";

type ShownConfidence = Confidence | "mixed";

const COPY: Record<ShownConfidence, { label: string; title: string }> = {
  estimated: {
    label: "Estimated",
    title: "Estimated from message timestamps. It shows when messages were sent, not time spent reading.",
  },
  measured: {
    label: "Measured",
    title: "Measured directly (for example by the Claude Code hook), not estimated from timestamps.",
  },
  mixed: {
    label: "Estimated + Measured",
    title: "Some of this covers days with measured data and some comes from an estimate. They are never blended for the same day.",
  },
  manual: {
    label: "Manual",
    title: "Entered by hand rather than estimated or measured.",
  },
};

/** Marks how trustworthy a duration is. Never hide it, and never claim "Estimated" for data that is not. */
export function ConfidenceBadge({ confidence, className = "" }: { confidence: ShownConfidence; className?: string }) {
  const { label, title } = COPY[confidence];
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-warn ${className}`}
    >
      {label}
    </span>
  );
}

/** Convenience for spots that only ever show import data, which is always confidence "estimated". */
export function EstimatedBadge({ className = "" }: { className?: string }) {
  return <ConfidenceBadge confidence="estimated" className={className} />;
}
