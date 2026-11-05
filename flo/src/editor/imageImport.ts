import { createImage } from '@/core/factory';
import type { Point } from '@/core/geometry';
import { projectRepo } from '@/persistence/projectRepo';
import { dispatch, getProject } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { t } from '@/i18n';
import { insertTree, resolveInsertTarget } from './actions';
import { registerAssetBlob } from './assetUrls';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Stores image files as project assets. Returns the created asset ids. */
export async function addImageAssets(files: File[]): Promise<string[]> {
  const project = getProject();
  if (!project) return [];
  const ids: string[] = [];
  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      useEditorStore.getState().showToast(t('assets.unsupported'), 'error');
      continue;
    }
    const meta = await projectRepo.putAsset(project.id, file, file.name);
    registerAssetBlob(project.id, meta.id, file);
    const res = dispatch([{ type: 'addAsset', asset: meta }], { label: 'Add asset' });
    if (res.ok) ids.push(meta.id);
  }
  return ids;
}

/** Inserts an image layer for an existing asset, scaled to fit within 600px. */
export function insertImageAsset(assetId: string, world?: Point, parentId?: string) {
  const project = getProject();
  const meta = project?.assets[assetId];
  if (!project || !meta) return;
  const scale = Math.min(1, 600 / Math.max(meta.width || 1, meta.height || 1));
  const width = Math.round((meta.width || 320) * scale);
  const height = Math.round((meta.height || 240) * scale);
  const target = parentId ?? resolveInsertTarget(project);
  const node = createImage({ parentId: target, width, height, name: meta.name.replace(/\.[a-z0-9]+$/i, '') }, { assetId, fills: [] });
  insertTree({ root: node, nodes: [node] }, target, world ? { x: world.x - width / 2, y: world.y - height / 2 } : undefined, 'Insert image');
}

export async function importAndInsertImages(files: File[], world?: Point, parentId?: string) {
  const ids = await addImageAssets(files);
  ids.forEach((id, i) => insertImageAsset(id, world ? { x: world.x + i * 24, y: world.y + i * 24 } : undefined, parentId));
}

export function removeAsset(assetId: string) {
  const res = dispatch([{ type: 'removeAsset', id: assetId }], { label: 'Remove asset' });
  if (!res.ok) useEditorStore.getState().showToast(t('assets.inUse'), 'error');
}

