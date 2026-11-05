/**
 * Transactional document store with undo/redo.
 *
 * `dispatch(ops)` applies validated ops inside an Immer producer and records the resulting
 * patches. Consecutive dispatches sharing a `mergeKey` (e.g. one drag gesture, or typing in
 * one inspector field) collapse into a single undo step.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { applyOps, type DocOp } from '@/core/ops';
import type { Project } from '@/core/schema';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  mergeKey?: string;
  time: number;
  /** Selection to restore when this entry is undone/redone. */
  selectionBefore: string[];
  selectionAfter: string[];
  /** Entry restored from storage: results are re-validated before use. */
  restored?: boolean;
}

export interface DispatchOptions {
  label?: string;
  mergeKey?: string;
  /** Merge window for mergeKey in ms (default 1200). Gestures pass Infinity. */
  mergeWindow?: number;
  selectionBefore?: string[];
  selectionAfter?: string[];
}

export type DispatchResult = { ok: true; project: Project } | { ok: false; error: string };

export const MAX_HISTORY = 300;

export function applyTransaction(
  project: Project,
  ops: DocOp[],
): { ok: true; project: Project; patches: Patch[]; inverse: Patch[] } | { ok: false; error: string } {
  try {
    const [next, patches, inverse] = produceWithPatches(project, (draft) => {
      applyOps(draft, ops);
    });
    return { ok: true, project: next, patches, inverse };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function pushHistory(past: HistoryEntry[], entry: HistoryEntry, mergeWindow: number): HistoryEntry[] {
  const last = past[past.length - 1];
  if (last && entry.mergeKey && last.mergeKey === entry.mergeKey && entry.time - last.time <= mergeWindow) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...entry.patches],
      inverse: [...entry.inverse, ...last.inverse],
      time: entry.time,
      selectionAfter: entry.selectionAfter,
    };
    return [...past.slice(0, -1), merged];
  }
  const next = [...past, entry];
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
}

export { applyPatches };
