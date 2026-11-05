/**
 * Schema migrations. Each migration upgrades raw data from version N to N+1.
 * Raw input is untrusted; the final result is always validated by `parseProject`.
 */
import { SCHEMA_VERSION, type Project } from './schema';
import { ProjectValidationError, parseProject } from './validate';

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** migrations[n] upgrades a document at version n to version n+1. */
export const migrations: Record<number, Migration> = {
  // Version 0 was the pre-release draft format without assets/guides.
  0: (raw) => ({
    ...raw,
    schemaVersion: 1,
    assets: raw.assets ?? {},
    pages: Array.isArray(raw.pages)
      ? raw.pages.map((p: Record<string, unknown>) => ({ background: '#1E1F25', guides: [], ...p }))
      : raw.pages,
  }),
  // Version 2 adds workflows (Milestone 3).
  1: (raw) => ({ ...raw, schemaVersion: 2, workflows: Array.isArray(raw.workflows) ? raw.workflows : [] }),
};

export function migrateProject(input: unknown): Project {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ProjectValidationError(['Project data must be an object']);
  }
  let raw = input as Record<string, unknown>;
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    throw new ProjectValidationError([`Project was created with a newer version of flö (schema ${version})`]);
  }
  while (version < SCHEMA_VERSION) {
    const m = migrations[version];
    if (!m) throw new ProjectValidationError([`No migration from schema ${version}`]);
    raw = m(raw);
    version += 1;
  }
  return parseProject(raw);
}
