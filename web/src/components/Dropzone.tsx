import { useRef, useState, type DragEvent } from "react";

interface Props {
  onFile: (file: File) => void;
  busy: boolean;
  compact?: boolean;
}

export function Dropzone({ onFile, busy, compact = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  };

  const zoneProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: handleDrop,
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".zip,.json,application/zip,application/json"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
        e.target.value = "";
      }}
    />
  );

  if (compact) {
    return (
      <div
        {...zoneProps}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${
          over ? "border-accent bg-accent/10" : "border-line bg-panel"
        }`}
      >
        <span className="text-muted">Drop another ChatGPT or Claude export here. Everything stays in your browser.</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded border border-line bg-raised px-3 py-1.5 text-ink hover:border-accent disabled:opacity-50"
        >
          {busy ? "Reading..." : "Choose file"}
        </button>
        {picker}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div
        {...zoneProps}
        role="button"
        tabIndex={0}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors ${
          over ? "border-accent bg-accent/10" : "border-line bg-panel hover:border-accent/60"
        }`}
      >
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#66c0f4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 16V4m0 0-4 4m4-4 4 4" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
        </svg>
        <h2 className="text-2xl font-semibold text-white">{busy ? "Reading your export..." : "See how long you have really spent with AI"}</h2>
        <p className="text-ink">
          Drop your <strong>ChatGPT</strong> or <strong>Claude</strong> export ZIP here, or click to choose it.
        </p>
        <p className="text-sm text-muted">A raw conversations.json works too.</p>
        <p className="mt-2 rounded-full border border-line bg-bg px-4 py-1.5 text-sm text-ink">
          Everything is processed in your browser. Your chats never leave your device.
        </p>
      </div>
      {picker}
      <div className="mt-6 grid gap-3 text-sm text-muted sm:grid-cols-2">
        <p>
          <span className="font-semibold text-ink">ChatGPT:</span> Settings, Data controls, Export data. You get an email with a ZIP.
        </p>
        <p>
          <span className="font-semibold text-ink">Claude:</span> Settings, Privacy, Export data. You get an email with a ZIP.
        </p>
      </div>
    </div>
  );
}
