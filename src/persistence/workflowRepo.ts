/** Persistence of workflow execution state (cache, history) and user templates. */
import type { CacheEntry, ExecutionRecord } from '@/core/workflow/engine';
import { db, type FloDB } from './db';

const MAX_HISTORY = 300;

export interface StoredTemplate {
  id: string;
  name: string;
  createdAt: number;
  workflow: { nodes: unknown[]; edges: unknown[] };
}

export function createWorkflowRepo(database: FloDB = db) {
  return {
    async loadCache(projectId: string): Promise<Map<string, Map<string, CacheEntry>>> {
      const rows = await database.runCache.where('projectId').equals(projectId).toArray();
      const out = new Map<string, Map<string, CacheEntry>>();
      for (const r of rows) {
        const m = out.get(r.workflowId) ?? new Map<string, CacheEntry>();
        m.set(r.nodeId, r.entry as CacheEntry);
        out.set(r.workflowId, m);
      }
      return out;
    },

    async saveCache(projectId: string, workflowId: string, cache: Map<string, CacheEntry>) {
      await database.transaction('rw', database.runCache, async () => {
        await database.runCache.where('workflowId').equals(workflowId).delete();
        await database.runCache.bulkPut(
          [...cache].map(([nodeId, entry]) => ({ id: `${projectId}:${workflowId}:${nodeId}`, projectId, workflowId, nodeId, entry })),
        );
      });
    },

    async loadHistory(projectId: string): Promise<ExecutionRecord[]> {
      const rows = await database.executions.where('projectId').equals(projectId).sortBy('startedAt');
      return rows.map((r) => r.record as ExecutionRecord);
    },

    async appendHistory(projectId: string, records: ExecutionRecord[]) {
      if (!records.length) return;
      await database.executions.bulkPut(records.map((r) => ({ id: r.id, projectId, workflowId: r.workflowId, startedAt: r.startedAt, record: r })));
      const count = await database.executions.where('projectId').equals(projectId).count();
      if (count > MAX_HISTORY) {
        const old = await database.executions.where('projectId').equals(projectId).sortBy('startedAt');
        await database.executions.bulkDelete(old.slice(0, count - MAX_HISTORY).map((r) => r.id));
      }
    },

    async listTemplates(): Promise<StoredTemplate[]> {
      const rows = await database.templates.orderBy('createdAt').reverse().toArray();
      return rows as StoredTemplate[];
    },

    async saveTemplate(t: StoredTemplate) {
      await database.templates.put(t);
    },

    async deleteTemplate(id: string) {
      await database.templates.delete(id);
    },
  };
}

export const workflowRepo = createWorkflowRepo();
