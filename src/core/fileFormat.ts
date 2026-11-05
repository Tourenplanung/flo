/**
 * Portable project file format (`.flo.json`): the document plus embedded image assets.
 * Imported files are untrusted: they are migrated, schema-validated, integrity-checked,
 * and image payloads are restricted to known raster MIME types.
 */
import { z } from 'zod';
import { createId } from './ids';
import { migrateProject } from './migrate';
import type { Project } from './schema';
import { ProjectValidationError } from './validate';

export const FILE_FORMAT = 'flo-project';
export const FILE_FORMAT_VERSION = 1;
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

const ALLOWED_DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

const FileSchema = z.object({
  format: z.literal(FILE_FORMAT),
  formatVersion: z.number().int().min(1),
  exportedAt: z.number().optional(),
  project: z.unknown(),
  assets: z.record(z.string(), z.string()).default({}),
});

export interface ProjectBundle {
  project: Project;
  /** asset id -> base64 data URL */
  assets: Record<string, string>;
}

export function serializeBundle(bundle: ProjectBundle): string {
  return JSON.stringify({
    format: FILE_FORMAT,
    formatVersion: FILE_FORMAT_VERSION,
    exportedAt: Date.now(),
    project: bundle.project,
    assets: bundle.assets,
  });
}

export function parseBundle(text: string): ProjectBundle {
  if (text.length > MAX_IMPORT_BYTES) throw new ProjectValidationError(['File is too large']);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectValidationError(['File is not valid JSON']);
  }
  const file = FileSchema.safeParse(json);
  if (!file.success) throw new ProjectValidationError(['Not a flö project file']);
  if (file.data.formatVersion > FILE_FORMAT_VERSION) {
    throw new ProjectValidationError(['File was created by a newer version of flö']);
  }
  const project = migrateProject(file.data.project);
  const assets: Record<string, string> = {};
  for (const [id, url] of Object.entries(file.data.assets)) {
    const meta = project.assets[id];
    if (!meta) continue; // ignore unreferenced payloads
    const m = ALLOWED_DATA_URL.exec(url);
    if (!m || m[1] !== meta.mimeType) throw new ProjectValidationError([`Asset ${id} has an invalid or mismatched payload`]);
    assets[id] = url;
  }
  return { project, assets };
}

/** Gives an imported project a fresh id so it never overwrites an existing local project. */
export function withNewIdentity(project: Project, name?: string): Project {
  return { ...project, id: createId(), name: name ?? project.name, createdAt: Date.now() };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = ALLOWED_DATA_URL.exec(dataUrl);
  if (!m) throw new Error('Invalid data URL');
  const bin = atob(m[2]!);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
