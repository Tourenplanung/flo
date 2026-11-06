/**
 * Editor side of the GitHub React import: fetches sources (read-only), converts the chosen
 * components with the static importer and stores them as flö components on a dedicated
 * "GitHub library" page, all in one undoable transaction.
 */
import { createPage } from '@/core/factory';
import { cloneSubtree } from '@/core/clone';
import { GithubClient, localImports, resolveImport, type GithubRef, type RepoFile, type RepoSnapshot } from '@/core/importers/github';
import type { ComponentInfo, ReactImporter, SourceFile } from '@/core/importers/reactImport';
import type { DocOp } from '@/core/ops';
import type { DesignNode, FrameNode, Project } from '@/core/schema';
import { dispatch, getProject } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { insertTree, resolveInsertTarget } from './actions';

export const LIBRARY_PAGE_NAMES = ['Libreria GitHub', 'GitHub library'];
const MAX_DEP_FILES = 30;

/** Downloads the selected files plus the local files they import (depth-limited). */
export async function fetchSources(client: GithubClient, snap: RepoSnapshot, selected: string[], onProgress?: (path: string) => void): Promise<SourceFile[]> {
  const out = new Map<string, string>();
  const queue = [...selected];
  let deps = 0;
  while (queue.length) {
    const path = queue.shift()!;
    if (out.has(path)) continue;
    onProgress?.(path);
    const code = await client.readFile(snap, path);
    out.set(path, code);
    for (const spec of localImports(code)) {
      const hit = resolveImport(path, spec, snap.files as RepoFile[]);
      if (hit && !out.has(hit) && !queue.includes(hit) && deps < MAX_DEP_FILES) {
        deps++;
        queue.push(hit);
      }
    }
  }
  return [...out.entries()].map(([path, code]) => ({ path, code }));
}

export interface ImportResult {
  count: number;
  pageId: string;
  warnings: string[];
  unknownClasses: string[];
}

function libraryPage(project: Project) {
  return project.pages.find((p) => LIBRARY_PAGE_NAMES.includes(p.name));
}

/** Converts the chosen components and adds them to the library page as flö components. */
export function importComponents(importer: ReactImporter, chosen: ComponentInfo[], snap: Pick<RepoSnapshot, 'owner' | 'repo' | 'sha' | 'license'>, lang: 'it' | 'en'): ImportResult | { error: string } {
  const project = getProject();
  if (!project) return { error: 'No project' };
  const ops: DocOp[] = [];
  let page = libraryPage(project);
  if (!page) {
    page = createPage(lang === 'it' ? LIBRARY_PAGE_NAMES[0]! : LIBRARY_PAGE_NAMES[1]!);
    page.background = '#F4F4F5';
    ops.push({ type: 'createPage', page });
  }
  // Place new components below what is already on the page.
  let y = 0;
  for (const id of page.childIds) {
    const n = project.nodes[id];
    if (n) y = Math.max(y, n.y + n.height + 120);
  }
  let x = 0;
  let rowH = 0;
  let count = 0;
  const ROW = 2400;
  for (const info of chosen) {
    const converted = importer.convert(info, page.id);
    for (const c of converted) {
      const root = c.tree.root as FrameNode;
      if (x > 0 && x + c.width > ROW) {
        x = 0;
        y += rowH + 120;
        rowH = 0;
      }
      root.x = x;
      root.y = y;
      root.component = {
        set: c.name.slice(0, 100),
        variant: Object.fromEntries(Object.entries(c.variant).map(([k, v]) => [k.slice(0, 40), v.slice(0, 40)])),
        description: `${snap.owner}/${snap.repo} · ${c.file}`.slice(0, 500),
        source: { kind: 'github', repo: `${snap.owner}/${snap.repo}`, path: c.file.slice(0, 500), commit: snap.sha, license: snap.license?.slice(0, 100) ?? null },
      };
      ops.push({ type: 'insertTree', nodes: c.tree.nodes });
      x += c.width + 80;
      rowH = Math.max(rowH, c.height);
      count++;
    }
  }
  if (!count) return { error: lang === 'it' ? 'Nessun componente convertito.' : 'No component converted.' };
  const res = dispatch(ops, { label: 'Import from GitHub' });
  if (!res.ok) return { error: res.error };
  const report = importer.report();
  return { count, pageId: page.id, warnings: report.warnings, unknownClasses: report.unknownClasses };
}

/** Main components imported from GitHub, grouped by component set. */
export function githubComponents(project: Project): { set: string; repo: string; items: FrameNode[] }[] {
  const groups = new Map<string, { set: string; repo: string; items: FrameNode[] }>();
  for (const page of project.pages) {
    for (const id of page.childIds) {
      const n = project.nodes[id];
      if (n?.type !== 'frame' || n.component?.source?.kind !== 'github') continue;
      const key = `${n.component.source.repo}::${n.component.set}`;
      if (!groups.has(key)) groups.set(key, { set: n.component.set, repo: n.component.source.repo, items: [] });
      groups.get(key)!.items.push(n);
    }
  }
  return [...groups.values()];
}

/** Inserts an editable copy (all layers detached) of an imported component. */
export function insertGithubCopy(componentId: string) {
  const project = getProject();
  const main = project?.nodes[componentId];
  if (!project || main?.type !== 'frame') return;
  let target = resolveInsertTarget(project);
  // Never insert into the library page's own components.
  if (isInsideComponent(project, target)) target = useEditorStore.getState().pageId!;
  const nodes = cloneSubtree(project.nodes, componentId, target) as DesignNode[];
  const root = nodes[0] as FrameNode;
  root.component = null;
  root.name = main.component?.set ?? main.name;
  insertTree({ root, nodes }, target, undefined, 'Insert GitHub component');
}

function isInsideComponent(project: Project, id: string): boolean {
  let n = project.nodes[id];
  while (n) {
    if (n.type === 'frame' && n.component) return true;
    n = project.nodes[n.parentId];
  }
  return false;
}

export type { GithubRef };
