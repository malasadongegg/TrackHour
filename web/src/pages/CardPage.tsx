import { useMemo } from "react";
import { buildCardData, renderCard, type CardConfig, type ClaudeCodeUsageStats, type ConversationRecord, type Session, type ToolKey } from "@trackhour/core";
import { CardControls } from "../components/card/CardControls";
import { CardPreview } from "../components/card/CardPreview";

interface Props {
  sessions: Session[];
  records: ConversationRecord[];
  now: number;
  timeZone: string;
  toolsWithData: ToolKey[];
  claudeCodeUsage: ClaudeCodeUsageStats | null;
  config: CardConfig;
  onChange: (next: Partial<CardConfig>) => void;
  onReset: () => void;
}

export function CardPage({ sessions, records, now, timeZone, toolsWithData, claudeCodeUsage, config, onChange, onReset }: Props) {
  // config.tools is a fresh array on every edit (normalizeCardConfig always
  // rebuilds it), even when the tool selection itself did not change, so a
  // dependency on the array ITSELF would rebuild these stats over every
  // session on every keystroke: typing the title, dragging a color, ticking
  // an unrelated stat. Depending on its contents instead means the (real)
  // stats computation over all sessions only reruns when the tools you
  // actually picked change.
  const toolsKey = config.tools.join(",");
  const data = useMemo(() => {
    const base = buildCardData(sessions, records, { now, timeZone }, config.tools);
    // claudeCodeUsage is token data, unrelated to sessions/tools, so it is attached here rather
    // than threaded through buildCardData's own (session-shaped) signature.
    return claudeCodeUsage ? { ...base, claudeCodeUsage } : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toolsKey stands in for config.tools on purpose, see above
  }, [sessions, records, now, timeZone, toolsKey, claudeCodeUsage]);
  const svg = useMemo(() => renderCard(config, data), [config, data]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-white">Design your card</h2>
        <p className="text-sm text-muted">Everything updates live. Nothing is uploaded, and the card holds only totals and dates.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <CardControls config={config} toolsWithData={toolsWithData} hasClaudeCodeUsage={claudeCodeUsage !== null} onChange={onChange} onReset={onReset} />
        {/* Preview first on phones, right column on desktop. */}
        <div className="order-first self-start lg:sticky lg:top-6 lg:order-none">
          <CardPreview svg={svg} />
        </div>
      </div>
    </div>
  );
}
