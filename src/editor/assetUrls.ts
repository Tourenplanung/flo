/** Resolves project asset ids to object URLs (cached per project session). */
import { useEffect, useState } from 'react';
import { projectRepo } from '@/persistence/projectRepo';

const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

export function assetUrlKey(projectId: string, assetId: string) {
  return `${projectId}:${assetId}`;
}

export function registerAssetBlob(projectId: string, assetId: string, blob: Blob) {
  const key = assetUrlKey(projectId, assetId);
  const prev = cache.get(key);
  if (prev) URL.revokeObjectURL(prev);
  cache.set(key, URL.createObjectURL(blob));
  listeners.forEach((l) => l());
}

export function resolveAssetUrl(projectId: string, assetId: string): Promise<string | null> {
  const key = assetUrlKey(projectId, assetId);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = projectRepo.getAssetBlob(projectId, assetId).then((blob) => {
      pending.delete(key);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      cache.set(key, url);
      return url;
    });
    pending.set(key, p);
  }
  return p;
}

export function clearAssetUrls() {
  cache.forEach((url) => URL.revokeObjectURL(url));
  cache.clear();
}

export function useAssetUrl(projectId: string | undefined, assetId: string | null | undefined): string | null {
  const key = projectId && assetId ? assetUrlKey(projectId, assetId) : null;
  const [url, setUrl] = useState<string | null>(key ? cache.get(key) ?? null : null);
  useEffect(() => {
    if (!projectId || !assetId) return setUrl(null);
    let alive = true;
    const update = () => resolveAssetUrl(projectId, assetId).then((u) => alive && setUrl(u));
    update();
    listeners.add(update);
    return () => {
      alive = false;
      listeners.delete(update);
    };
  }, [projectId, assetId]);
  return url;
}
