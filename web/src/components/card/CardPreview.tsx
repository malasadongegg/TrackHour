import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  svg: string;
}

/**
 * Live preview. The SVG is shown through an <img> with a data URL, which is
 * exactly how it behaves when embedded elsewhere: scripts are blocked and only
 * self-contained content renders. So what you see here is what others will see.
 */
export function CardPreview({ svg }: Props) {
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");
  const [backdrop, setBackdrop] = useState<"dark" | "light">("dark");
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const url = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, [svg]);
  const kb = (new Blob([svg]).size / 1024).toFixed(1);

  const flash = (state: "ok" | "failed") => {
    setCopied(state);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied("idle"), 2200);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(svg);
      flash("ok");
    } catch {
      flash("failed");
    }
  };

  const download = () => {
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "ai-playtime-card.svg";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  };

  return (
    <div className="space-y-3">
      <div
        className={`flex items-center justify-center overflow-hidden rounded-lg border border-line p-4 sm:p-8 ${
          backdrop === "dark" ? "bg-[#0d1117]" : "bg-white"
        }`}
      >
        <img src={url} alt="Live preview of your card" className="h-auto max-w-full" width={495} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={download} className="rounded bg-accent px-4 py-2 text-sm font-semibold text-bg hover:brightness-110">
          Download SVG
        </button>
        <button type="button" onClick={copy} className="rounded border border-line bg-raised px-4 py-2 text-sm text-ink hover:border-accent">
          {copied === "ok" ? "Copied" : "Copy SVG markup"}
        </button>
        <span role="status" className="text-xs text-muted">
          {copied === "failed" ? "Copy was blocked by the browser. Use Download instead." : `${kb} KB, self-contained`}
        </span>
        <div className="ml-auto flex items-center gap-1 text-xs" role="group" aria-label="Preview background">
          <span className="mr-1 text-muted">Preview on</span>
          {(["dark", "light"] as const).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={backdrop === b}
              onClick={() => setBackdrop(b)}
              className={`rounded px-2 py-1 capitalize ${backdrop === b ? "bg-raised text-white" : "text-muted hover:text-ink"}`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        Drop the file in a README, Notion page or your site with an image tag. For a link that updates itself, sign in on the Account tab.
      </p>
    </div>
  );
}
