/**
 * Local-first project repository on IndexedDB. Every document read from storage is
 * migrated + validated before use, so corrupted or tampered data cannot enter the editor.
 */
import { createProject } from '@/core/factory';
import { blobToDataUrl, dataUrlToBlob, parseBundle, serializeBundle, withNewIdentity } from '@/core/fileFormat';
import { createId } from '@/core/ids';
import { migrateProject } from '@/core/migrate';
import type { AssetMeta, Project } from '@/core/schema';
import { db, type FloDB } from './db';

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export function createRepo(database: FloDB = db) {
  return {
    async list(): Promise<ProjectSummary[]> {
      const rows = await database.projects.orderBy('updatedAt').reverse().toArray();
      return rows.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }));
    },

    async load(id: string): Promise<Project | null> {
      const row = await database.projects.get(id);
      if (!row) return null;
      return migrateProject(row.doc);
    },

    async save(project: Project): Promise<void> {
      const existing = await database.projects.get(project.id);
      await database.projects.put({
        id: project.id,
        name: project.name,
        createdAt: existing?.createdAt ?? project.createdAt,
        updatedAt: Date.now(),
        doc: project,
      });
    },

    async create(name: string, pageName?: string): Promise<Project> {
      const project = createProject(name, pageName);
      await this.save(project);
      return project;
    },

    async rename(id: string, name: string): Promise<void> {
      const project = await this.load(id);
      if (!project) return;
      await this.save({ ...project, name });
    },

    async duplicate(id: string, suffix: string): Promise<Project | null> {
      const project = await this.load(id);
      if (!project) return null;
      const copy = withNewIdentity(project, `${project.name} ${suffix}`);
      const assets = await database.assets.where('projectId').equals(id).toArray();
      await database.transaction('rw', database.projects, database.assets, async () => {
        await this.save(copy);
        await database.assets.bulkPut(
          assets.map((a) => ({ id: `${copy.id}:${a.id.split(':').pop()}`, projectId: copy.id, blob: a.blob })),
        );
      });
      return copy;
    },

    async remove(id: string): Promise<void> {
      await database.transaction('rw', database.projects, database.assets, async () => {
        await database.projects.delete(id);
        await database.assets.where('projectId').equals(id).delete();
      });
    },

    /* ---------------- assets ---------------- */

    assetKey: (projectId: string, assetId: string) => `${projectId}:${assetId}`,

    async putAsset(projectId: string, file: Blob, name: string): Promise<AssetMeta> {
      const type = file.type;
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) {
        throw new Error('Unsupported image type');
      }
      const dims = await imageSize(file).catch(() => ({ width: 0, height: 0 }));
      const meta: AssetMeta = {
        id: createId(),
        name: name.slice(0, 200) || 'image',
        mimeType: type as AssetMeta['mimeType'],
        width: dims.width,
        height: dims.height,
        size: file.size,
      };
      await database.assets.put({ id: this.assetKey(projectId, meta.id), projectId, blob: file });
      return meta;
    },

    async getAssetBlob(projectId: string, assetId: string): Promise<Blob | null> {
      const row = await database.assets.get(this.assetKey(projectId, assetId));
      return row?.blob ?? null;
    },

    /* ---------------- import / export ---------------- */

    /** Exports the stored project, or `live` (the in-memory document) when given. */
    async exportBundle(id: string, live?: Project): Promise<string> {
      const project = live && live.id === id ? live : await this.load(id);
      if (!project) throw new Error('Project not found');
      const assets: Record<string, string> = {};
      for (const assetId of Object.keys(project.assets)) {
        const blob = await this.getAssetBlob(id, assetId);
        if (blob) assets[assetId] = await blobToDataUrl(blob);
      }
      return serializeBundle({ project, assets });
    },

    async importBundle(text: string): Promise<Project> {
      const bundle = parseBundle(text);
      const project = withNewIdentity(bundle.project);
      await database.transaction('rw', database.projects, database.assets, async () => {
        await this.save(project);
        for (const [assetId, url] of Object.entries(bundle.assets)) {
          await database.assets.put({ id: this.assetKey(project.id, assetId), projectId: project.id, blob: dataUrlToBlob(url) });
        }
      });
      return project;
    },
  };
}

function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return reject(new Error('no DOM'));
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Invalid image'));
    };
    img.src = url;
  });
}

export type ProjectRepo = ReturnType<typeof createRepo>;
export const projectRepo = createRepo();
