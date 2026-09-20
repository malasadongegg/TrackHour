/** Marks numbers that come from message timestamps rather than measured time. Never hide it. */
export function EstimatedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Estimated from message timestamps. It shows when messages were sent, not time spent reading."
      className={`inline-flex items-center rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-warn ${className}`}
    >
      Estimated
    </span>
  );
}
