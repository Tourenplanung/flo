import { useEffect } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { cx } from './controls';

export function Toast() {
  const toast = useEditorStore((s) => s.toast);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => useEditorStore.setState({ toast: null }), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast) return null;
  return (
    <div
      role="status"
      className={cx(
        'fixed bottom-5 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border px-3 py-2 text-[12px] shadow-2xl',
        toast.tone === 'error' ? 'border-danger/40 bg-[#2a1418] text-[#ffc9cf]' : 'border-line-strong bg-elevated text-fg',
      )}
    >
      {toast.message}
    </div>
  );
}
