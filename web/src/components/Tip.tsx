import { useCallback, useState, type MouseEvent } from "react";

export interface TipState {
  x: number;
  y: number;
  title: string;
  detail: string;
}

/** Hover tooltip shared by the heatmap and bar chart. Anchored above the hovered mark. */
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: MouseEvent<Element>, title: string, detail: string) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, title, detail });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

export function TipLayer({ tip }: { tip: TipState | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y - 8, transform: "translate(-50%, -100%)" }}
    >
      <div className="num font-semibold text-white">{tip.detail}</div>
      <div className="text-muted">{tip.title}</div>
    </div>
  );
}
