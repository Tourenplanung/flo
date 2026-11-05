/** Workflow execution state (statuses, cache, history) — separate from the document. */
import { create } from 'zustand';
import { createId } from '@/core/ids';
import { downstreamOf } from '@/core/workflow/graph';
import { runWorkflow, type CacheEntry, type ExecutionRecord, type NodeStatus } from '@/core/workflow/engine';
import { createEditorHost } from '@/editor/workflowHost';
import { workflowRepo } from '@/persistence/workflowRepo';
import { getProject } from './docStore';

export type UiStatus = NodeStatus | 'stale';

interface WorkflowState {
  projectId: string | null;
  activeId: string | null;
  selectedNodeId: string | null;
  statuses: Record<string, UiStatus>;
  errors: Record<string, string>;
  history: ExecutionRecord[];
  running: boolean;
  /** Bumped whenever a cache changes so previews re-render. */
  cacheVersion: number;

  init: (projectId: string) => Promise<void>;
  setActive: (id: string | null) => void;
  selectNode: (id: string | null) => void;
  markStale: (workflowId: string, nodeId: string) => void;
  run: (workflowId: string, opts?: { targetId?: string; force?: boolean }) => Promise<void>;
  clearHistory: () => void;
}

/** In-memory caches per workflow; persisted to IndexedDB after each run. */
const caches = new Map<string, Map<string, CacheEntry>>();

export function getCache(workflowId: string): Map<string, CacheEntry> {
  let c = caches.get(workflowId);
  if (!c) caches.set(workflowId, (c = new Map()));
  return c;
}

export const useWorkflowStore = create<WorkflowState>()((set, get) => ({
  projectId: null,
  activeId: null,
  selectedNodeId: null,
  statuses: {},
  errors: {},
  history: [],
  running: false,
  cacheVersion: 0,

  init: async (projectId) => {
    caches.clear();
    set({ projectId, activeId: getProject()?.workflows[0]?.id ?? null, selectedNodeId: null, statuses: {}, errors: {}, history: [], running: false });
    try {
      const [loaded, history] = await Promise.all([workflowRepo.loadCache(projectId), workflowRepo.loadHistory(projectId)]);
      if (get().projectId !== projectId) return;
      loaded.forEach((m, wid) => caches.set(wid, m));
      const statuses: Record<string, UiStatus> = {};
      loaded.forEach((m) => m.forEach((_e, nodeId) => (statuses[nodeId] = 'cached')));
      set((s) => ({ history, statuses: { ...statuses, ...s.statuses }, cacheVersion: s.cacheVersion + 1 }));
    } catch (e) {
      console.warn('[flö] could not load workflow state', e);
    }
  },
  setActive: (activeId) => set({ activeId, selectedNodeId: null }),
  selectNode: (selectedNodeId) => get().selectedNodeId !== selectedNodeId && set({ selectedNodeId }),
  markStale: (workflowId, nodeId) => {
    const wf = getProject()?.workflows.find((w) => w.id === workflowId);
    if (!wf) return;
    const affected = downstreamOf(wf, nodeId);
    set((s) => {
      const statuses = { ...s.statuses };
      affected.forEach((id) => {
        if (statuses[id] && statuses[id] !== 'unavailable') statuses[id] = 'stale';
      });
      return { statuses };
    });
  },
  run: async (workflowId, opts = {}) => {
    const project = getProject();
    const wf = project?.workflows.find((w) => w.id === workflowId);
    if (!project || !wf || get().running) return;
    set({ running: true });
    const cache = getCache(workflowId);
    try {
      const res = await runWorkflow(wf, cache, createEditorHost(), {
        targetId: opts.targetId,
        force: opts.force ? (opts.targetId ? new Set([opts.targetId]) : true) : undefined,
        newId: () => createId(),
        onStatus: (nodeId, status, error) =>
          set((s) => {
            const errors = { ...s.errors };
            if (error) errors[nodeId] = error;
            else delete errors[nodeId];
            return { statuses: { ...s.statuses, [nodeId]: status }, errors };
          }),
      });
      set((s) => ({ history: [...s.history, ...res.records].slice(-300), cacheVersion: s.cacheVersion + 1 }));
      await Promise.all([workflowRepo.saveCache(project.id, workflowId, cache), workflowRepo.appendHistory(project.id, res.records)]).catch((e) =>
        console.warn('[flö] could not persist workflow state', e),
      );
    } catch (e) {
      console.error('[flö] workflow run failed', e);
    } finally {
      set({ running: false });
    }
  },
  clearHistory: () => set({ history: [] }),
}));
