import Dexie, { type Table } from 'dexie';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The validated project document (see core/schema). Stored as plain data. */
  doc: unknown;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  blob: Blob;
}

export class FloDB extends Dexie {
  projects!: Table<ProjectRecord, string>;
  assets!: Table<AssetRecord, string>;

  constructor(name = 'flo') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt, name',
      assets: 'id, projectId',
    });
  }
}

export const db = new FloDB();
