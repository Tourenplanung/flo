import { PanelLeft, PanelRight, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { cx } from './controls';

/** Below this width the side panels become drawers over the canvas. */
export const COMPACT_QUERY = '(max-width: 1023px)';

export function useCompact(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const on = () => setCompact(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

export type DrawerId = 'left' | 'right';

/** Which drawer is open on compact screens (only one at a time). */
export const useDrawer = create<{ open: DrawerId | null; setOpen: (d: DrawerId | null) => void; toggle: (d: DrawerId) => void }>()((set, get) => ({
  open: null,
  setOpen: (open) => set({ open }),
  toggle: (d) => set({ open: get().open === d ? null : d }),
}));

/** Closes the drawers after an action that should reveal the canvas (e.g. inserting). */
export const closeDrawers = () => useDrawer.getState().setOpen(null);

/**
 * A side panel: a normal column on wide screens, a drawer over the content on compact screens.
 * The parent must be `position: relative`.
 */
export function SidePanel({ side, className, label, testId, children }: { side: DrawerId; className: string; label: string; testId?: string; children: ReactNode }) {
  const compact = useCompact();
  const open = useDrawer((s) => s.open === side);
  if (!compact) {
    return (
      <aside className={className} aria-label={label} data-testid={testId}>
        {children}
      </aside>
    );
  }
  if (!open) return null;
  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/40" onPointerDown={() => useDrawer.getState().setOpen(null)} />
      <aside
        className={cx(className, 'absolute inset-y-0 z-40 !w-[min(340px,88vw)] shadow-2xl', side === 'left' ? 'left-0' : 'right-0')}
        aria-label={label}
        data-testid={testId}
        data-drawer={side}
      >
        <div className="sticky top-0 z-10 flex h-9 shrink-0 items-center justify-end border-b border-line bg-panel px-1.5">
          <button
            aria-label="Chiudi"
            data-testid={`drawer-close-${side}`}
            onClick={() => useDrawer.getState().setOpen(null)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-field hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}

/** Floating buttons that open the drawers on compact screens. */
export function DrawerButtons({ left, right }: { left: string; right: string }) {
  const compact = useCompact();
  const open = useDrawer((s) => s.open);
  if (!compact) return null;
  const btn = 'pointer-events-auto flex h-10 items-center gap-1.5 rounded-full border border-line-strong bg-elevated/95 px-3.5 text-[12px] text-fg shadow-xl backdrop-blur';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-between px-3">
      <button data-testid="drawer-left" className={cx(btn, open === 'left' && 'border-accent')} onClick={() => useDrawer.getState().toggle('left')}>
        <PanelLeft size={15} /> {left}
      </button>
      <button data-testid="drawer-right" className={cx(btn, open === 'right' && 'border-accent')} onClick={() => useDrawer.getState().toggle('right')}>
        {right} <PanelRight size={15} />
      </button>
    </div>
  );
}
