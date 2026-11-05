/** Debounced autosave of the open project to IndexedDB, with flush on hide/unload. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { projectRepo } from '@/persistence/projectRepo';
import { useDocStore } from '@/store/docStore';

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

const DEBOUNCE_MS = 500;
/** Upper bound between saves while the user keeps editing continuously. */
const MAX_WAIT_MS = 3000;

export function useAutosave(): { status: SaveStatus; saveNow: () => void } {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedRevision = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const firstPending = useRef<number | null>(null);

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    firstPending.current = null;
    const { project, revision } = useDocStore.getState();
    if (!project || revision === savedRevision.current) return;
    setStatus('saving');
    const run = async () => {
      if (inFlight.current) await inFlight.current.catch(() => undefined);
      try {
        await projectRepo.save(project);
        savedRevision.current = revision;
        setStatus(useDocStore.getState().revision === revision ? 'saved' : 'unsaved');
      } catch (e) {
        console.error('[flö] autosave failed', e);
        setStatus('error');
      }
    };
    inFlight.current = run();
  }, []);

  useEffect(() => {
    savedRevision.current = useDocStore.getState().revision;
    const unsub = useDocStore.subscribe((s, prev) => {
      if (s.revision === prev.revision || !s.project) return;
      setStatus('unsaved');
      if (timer.current) clearTimeout(timer.current);
      const now = Date.now();
      firstPending.current ??= now;
      const wait = Math.max(0, Math.min(DEBOUNCE_MS, firstPending.current + MAX_WAIT_MS - now));
      timer.current = setTimeout(saveNow, wait);
    });
    const flush = () => saveNow();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsub();
      flush();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [saveNow]);

  return { status, saveNow };
}
