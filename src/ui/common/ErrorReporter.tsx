import { Component, useEffect, useState, type ReactNode } from 'react';

/** Visible report of unexpected errors, so the app never looks silently frozen. */
function ErrorPanel({ message, onClose }: { message: string; onClose?: () => void }) {
  return (
    <div role="alert" data-testid="error-report" className="fixed bottom-3 left-1/2 z-[100] w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-lg border border-[#ff5f6d] bg-[#2a1418] p-3 text-[12px] text-[#ffd0d5] shadow-2xl">
      <p className="mb-1 font-semibold">Si è verificato un errore / An error occurred</p>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{message}</pre>
      <div className="mt-2 flex gap-2">
        <button className="rounded bg-[#ff5f6d] px-2.5 py-1 text-white" onClick={() => location.reload()}>
          Ricarica
        </button>
        {onClose && (
          <button className="rounded px-2.5 py-1 text-[#ffd0d5] hover:underline" onClick={onClose}>
            Chiudi
          </button>
        )}
      </div>
    </div>
  );
}

/** Catches uncaught errors and rejected promises outside React rendering. */
export function GlobalErrors() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const onError = (e: ErrorEvent) => setMsg(`${e.message}${e.filename ? `\n${e.filename}:${e.lineno}` : ''}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string } | undefined;
      const text = r?.message ?? String(e.reason);
      // Aborted requests are expected (user cancelled).
      if (/abort/i.test(text)) return;
      setMsg(text);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return msg ? <ErrorPanel message={msg} onClose={() => setMsg(null)} /> : null;
}

/** Catches rendering errors (including a lazy chunk that fails to load). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <ErrorPanel message={`${this.state.error.message}\n${(this.state.error.stack ?? '').split('\n').slice(0, 4).join('\n')}`} />;
    return this.props.children;
  }
}
