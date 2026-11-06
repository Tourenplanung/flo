/**
 * Schema migrations. Each migration upgrades raw data from version N to N+1.
 * Raw input is untrusted; the final result is always validated by `parseProject`.
 */
import { defaultBreakpoints, emptyTokens } from './factory';
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
  // Version 3 adds design tokens, breakpoints, constraints, bindings, responsive overrides and components.
  2: (raw) => {
    const nodes: Record<string, unknown> = {};
    if (raw.nodes && typeof raw.nodes === 'object') {
      for (const [id, n] of Object.entries(raw.nodes as Record<string, Record<string, unknown>>)) {
        if (!n || typeof n !== 'object') {
          nodes[id] = n;
          continue;
        }
        nodes[id] = {
          constraints: { horizontal: 'start', vertical: 'start' },
          bindings: {},
          responsive: {},
          ...(n.type === 'frame' ? { component: null } : {}),
          ...n,
        };
      }
    }
    return { ...raw, schemaVersion: 3, nodes, tokens: raw.tokens ?? emptyTokens(), breakpoints: raw.breakpoints ?? defaultBreakpoints() };
  },
  // Version 4 adds prototype interactions and the prototype start screen.
  3: (raw) => {
    const nodes: Record<string, unknown> = {};
    for (const [id, n] of Object.entries((raw.nodes ?? {}) as Record<string, Record<string, unknown>>)) {
      nodes[id] = n && typeof n === 'object' ? { interactions: [], ...n } : n;
    }
    return { ...raw, schemaVersion: 4, nodes, prototype: raw.prototype ?? { startFrameId: null } };
  },
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
