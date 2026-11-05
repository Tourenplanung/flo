import { create } from 'zustand';
import type { DocOp } from '@/core/ops';
import type { Project } from '@/core/schema';
import { applyPatches, applyTransaction, pushHistory, type DispatchOptions, type DispatchResult, type HistoryEntry } from './history';
import { useEditorStore } from './editorStore';

interface DocState {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Incremented on every change; used by autosave. */
  revision: number;
  lastError: string | null;
  load: (project: Project) => void;
  close: () => void;
  dispatch: (ops: DocOp[], opts?: DispatchOptions) => DispatchResult;
  undo: () => void;
  redo: () => void;
  /** Ends any open merge group so the next change starts a new undo step. */
  sealHistory: () => void;
}

export const useDocStore = create<DocState>()((set, get) => ({
  project: null,
  past: [],
  future: [],
  revision: 0,
  lastError: null,
  load: (project) => set({ project, past: [], future: [], revision: 0, lastError: null }),
  close: () => set({ project: null, past: [], future: [], revision: 0 }),
  dispatch: (ops, opts = {}) => {
    const { project } = get();
    if (!project) return { ok: false, error: 'No project open' };
    if (!ops.length) return { ok: true, project };
    const res = applyTransaction(project, ops);
    if (!res.ok) {
      set({ lastError: res.error });
      console.warn('[flö] rejected operation:', res.error);
      return res;
    }
    if (!res.patches.length) return { ok: true, project };
    const selection = useEditorStore.getState().selection;
    const entry: HistoryEntry = {
      label: opts.label ?? ops[0]!.type,
      patches: res.patches,
      inverse: res.inverse,
      mergeKey: opts.mergeKey,
      time: Date.now(),
      selectionBefore: opts.selectionBefore ?? selection,
      selectionAfter: opts.selectionAfter ?? selection,
    };
    set((s) => ({
      project: res.project,
      past: pushHistory(s.past, entry, opts.mergeWindow ?? 1200),
      future: [],
      revision: s.revision + 1,
      lastError: null,
    }));
    return { ok: true, project: res.project };
  },
  undo: () => {
    const { project, past, future } = get();
    const entry = past[past.length - 1];
    if (!project || !entry) return;
    const next = applyPatches(project, entry.inverse);
    set((s) => ({ project: next, past: past.slice(0, -1), future: [...future, entry], revision: s.revision + 1 }));
    useEditorStore.getState().restoreSelection(entry.selectionBefore, next);
  },
  redo: () => {
    const { project, past, future } = get();
    const entry = future[future.length - 1];
    if (!project || !entry) return;
    const next = applyPatches(project, entry.patches);
    set((s) => ({ project: next, past: [...past, entry], future: future.slice(0, -1), revision: s.revision + 1 }));
    useEditorStore.getState().restoreSelection(entry.selectionAfter, next);
  },
  sealHistory: () => {
    const { past } = get();
    const last = past[past.length - 1];
    if (last?.mergeKey) set({ past: [...past.slice(0, -1), { ...last, mergeKey: undefined }] });
  },
}));

export const getProject = () => useDocStore.getState().project;
export const dispatch = (ops: DocOp[], opts?: DispatchOptions) => useDocStore.getState().dispatch(ops, opts);
