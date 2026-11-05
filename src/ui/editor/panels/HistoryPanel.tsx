import { Circle, CircleDot } from 'lucide-react';
import { useT } from '@/i18n';
import { useDocStore } from '@/store/docStore';
import { cx } from '@/ui/common/controls';

/** Project history: click an entry to go back (undo) or forward (redo) to that state. */
export function HistoryPanel() {
  const t = useT();
  const past = useDocStore((s) => s.past);
  const future = useDocStore((s) => s.future);
  const fmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const goTo = (pastIndex: number) => {
    // pastIndex = number of entries that should remain applied.
    const s = useDocStore.getState();
    let steps = s.past.length - pastIndex;
    while (steps > 0) {
      useDocStore.getState().undo();
      steps--;
    }
    while (steps < 0) {
      useDocStore.getState().redo();
      steps++;
    }
  };

  if (!past.length && !future.length) return <p className="px-3 py-3 text-[11px] text-fg-subtle">{t('hist.empty')}</p>;
  // Future entries are stored most-recent-undo last; show them in chronological order.
  const futureChrono = [...future].reverse();
  return (
    <ol className="py-1 text-[11px]" data-testid="history-panel">
      <li>
        <button className={cx('flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-field-hover', past.length === 0 ? 'text-fg' : 'text-fg-muted')} onClick={() => goTo(0)}>
          <Circle size={9} /> <span className="flex-1">{t('hist.start')}</span>
        </button>
      </li>
      {past.map((e, i) => {
        const current = i === past.length - 1;
        return (
          <li key={`p${i}`}>
            <button
              data-testid="history-entry"
              className={cx('flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-field-hover', current ? 'bg-accent/15 text-fg' : 'text-fg-muted')}
              onClick={() => goTo(i + 1)}
              title={current ? t('hist.current') : undefined}
            >
              {current ? <CircleDot size={9} className="text-accent" /> : <Circle size={9} />}
              <span className="flex-1 truncate">{e.label}</span>
              <span className="tabular-nums text-fg-subtle">{fmt.format(e.time)}</span>
            </button>
          </li>
        );
      })}
      {futureChrono.map((e, i) => (
        <li key={`f${i}`}>
          <button className="flex w-full items-center gap-2 px-3 py-1 text-left text-fg-subtle line-through decoration-fg-subtle/40 hover:bg-field-hover" onClick={() => goTo(past.length + i + 1)}>
            <Circle size={9} />
            <span className="flex-1 truncate">{e.label}</span>
            <span className="tabular-nums">{fmt.format(e.time)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
