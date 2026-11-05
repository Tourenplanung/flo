import { Monitor, Plus, Settings2, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createId } from '@/core/ids';
import type { Breakpoint } from '@/core/schema';
import { useT } from '@/i18n';
import { dispatch, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { cx, IconButton, NumberField } from '@/ui/common/controls';

const iconFor = (bp: Breakpoint | null) => (!bp ? Monitor : bp.maxWidth <= 700 ? Smartphone : Tablet);

function save(breakpoints: Breakpoint[]) {
  const res = dispatch([{ type: 'setBreakpoints', breakpoints }], { label: 'Edit breakpoints', mergeKey: 'bps' });
  if (!res.ok) useEditorStore.getState().showToast(res.error, 'error');
}

export function BreakpointBar() {
  const t = useT();
  const bps = useDocStore((s) => s.project?.breakpoints ?? []);
  const active = useEditorStore((s) => s.breakpointId);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editing) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setEditing(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [editing]);
  const sorted = [...bps].sort((a, b) => b.maxWidth - a.maxWidth);
  const items: (Breakpoint | null)[] = [null, ...sorted];

  return (
    <div
      ref={ref}
      className="absolute left-1/2 top-7 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-line-strong bg-elevated/95 p-0.5 shadow-xl backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="breakpoint-bar"
    >
      {items.map((bp) => {
        const Icon = iconFor(bp);
        const id = bp?.id ?? null;
        return (
          <button
            key={id ?? 'base'}
            data-testid={`bp-${bp ? bp.name.toLowerCase() : 'base'}`}
            aria-pressed={active === id}
            title={bp ? `${bp.name} ≤ ${bp.maxWidth}px` : t('bp.base')}
            onClick={() => useEditorStore.getState().setBreakpoint(id)}
            className={cx('flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px]', active === id ? 'bg-accent text-white' : 'text-fg-muted hover:bg-field-hover hover:text-fg')}
          >
            <Icon size={12} />
            {bp ? bp.name : t('bp.base')}
          </button>
        );
      })}
      <IconButton label={t('bp.edit')} active={editing} onClick={() => setEditing(!editing)}>
        <Settings2 size={13} />
      </IconButton>
      {editing && (
        <div className="absolute left-1/2 top-9 w-80 -translate-x-1/2 rounded-lg border border-line-strong bg-elevated p-2 shadow-2xl">
          <div className="mb-1 grid grid-cols-[1fr_76px_76px_20px] gap-1 px-1 text-[10px] text-fg-subtle">
            <span>{t('bp.name')}</span>
            <span>{t('bp.max')}</span>
            <span>{t('bp.preview')}</span>
            <span />
          </div>
          {bps.map((bp, i) => (
            <div key={bp.id} className="mb-1 grid grid-cols-[1fr_76px_76px_20px] items-center gap-1">
              <input
                defaultValue={bp.name}
                onBlur={(e) => e.target.value.trim() && save(bps.map((b, j) => (j === i ? { ...b, name: e.target.value.trim().slice(0, 60) } : b)))}
                className="h-7 min-w-0 rounded-md bg-field px-2 text-[11px] text-fg outline-none focus:ring-1 focus:ring-accent"
              />
              <NumberField label="≤" value={bp.maxWidth} min={120} max={10000} precision={0} onChange={(v, final) => final && save(bps.map((b, j) => (j === i ? { ...b, maxWidth: Math.round(v) } : b)))} />
              <NumberField label="▭" value={bp.previewWidth} min={120} max={10000} precision={0} onChange={(v, final) => final && save(bps.map((b, j) => (j === i ? { ...b, previewWidth: Math.round(v) } : b)))} />
              <button
                aria-label="Remove"
                className="text-fg-subtle hover:text-danger"
                onClick={() => {
                  if (useEditorStore.getState().breakpointId === bp.id) useEditorStore.getState().setBreakpoint(null);
                  save(bps.filter((b) => b.id !== bp.id));
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            className="mt-1 flex items-center gap-1 px-1 text-[11px] text-accent hover:underline"
            onClick={() => save([...bps, { id: createId(), name: `BP ${bps.length + 1}`, maxWidth: 480, previewWidth: 360 }])}
          >
            <Plus size={12} /> {t('bp.add')}
          </button>
        </div>
      )}
    </div>
  );
}
