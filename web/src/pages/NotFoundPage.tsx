export function NotFoundPage({ onHome }: { onHome: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-lg border border-line bg-panel p-6 text-center">
      <h2 className="text-lg font-semibold text-white">Page not found</h2>
      <p className="text-sm text-muted">There is nothing at this address.</p>
      <a
        href="/"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onHome();
        }}
        className="inline-block rounded bg-accent px-4 py-2 text-sm font-semibold text-bg hover:brightness-110"
      >
        Go to the dashboard
      </a>
    </div>
  );
}
