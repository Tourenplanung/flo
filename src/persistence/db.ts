import Dexie, { type Table } from 'dexie';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The validated project document (see core/schema). Stored as plain data. */
  doc: unknown;
  /** Undo/redo history (Immer patches), restored on reopen. Optional. */
  history?: unknown;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  blob: Blob;
}

/** Cached outputs of a workflow node (execution state, kept outside the document). */
export interface RunCacheRecord {
  id: string; // `${projectId}:${workflowId}:${nodeId}`
  projectId: string;
  workflowId: string;
  nodeId: string;
  entry: unknown;
}

export interface ExecutionRow {
  id: string;
  projectId: string;
  workflowId: string;
  startedAt: number;
  record: unknown;
}

export interface TemplateRecord {
  id: string;
  name: string;
  createdAt: number;
  workflow: unknown;
}

export class FloDB extends Dexie {
  projects!: Table<ProjectRecord, string>;
  assets!: Table<AssetRecord, string>;
  runCache!: Table<RunCacheRecord, string>;
  executions!: Table<ExecutionRow, string>;
  templates!: Table<TemplateRecord, string>;

  constructor(name = 'flo') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt, name',
      assets: 'id, projectId',
    });
    this.version(2).stores({
      runCache: 'id, projectId, workflowId',
      executions: 'id, projectId, workflowId, startedAt',
      templates: 'id, name, createdAt',
    });
  }
}

export const db = new FloDB();
