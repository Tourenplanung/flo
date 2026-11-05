/** Pure helpers to query the normalized document tree. */
import type { DesignNode, Page, Project } from './schema';

export function getPage(project: Project, pageId: string): Page | undefined {
  return project.pages.find((p) => p.id === pageId);
}

export function isPageId(project: Project, id: string): boolean {
  return project.pages.some((p) => p.id === id);
}

/** Ordered child ids of a page or node. */
export function getChildIds(project: Project, parentId: string): string[] {
  const node = project.nodes[parentId];
  if (node) return node.childIds;
  return getPage(project, parentId)?.childIds ?? [];
}

/** Returns the page that (transitively) contains the node. */
export function getPageOf(project: Project, nodeId: string): Page | undefined {
  let cur = project.nodes[nodeId];
  let guard = 0;
  while (cur && guard++ < 10_000) {
    const parent = project.nodes[cur.parentId];
    if (!parent) return getPage(project, cur.parentId);
    cur = parent;
  }
  return undefined;
}

/** Ancestors from the top-level node down to (and including) the node itself. */
export function getNodePath(project: Project, nodeId: string): DesignNode[] {
  const path: DesignNode[] = [];
  let cur = project.nodes[nodeId];
  let guard = 0;
  while (cur && guard++ < 10_000) {
    path.unshift(cur);
    cur = project.nodes[cur.parentId];
  }
  return path;
}

export function isAncestor(project: Project, ancestorId: string, nodeId: string): boolean {
  let cur = project.nodes[nodeId];
  let guard = 0;
  while (cur && guard++ < 10_000) {
    if (cur.parentId === ancestorId) return true;
    cur = project.nodes[cur.parentId];
  }
  return false;
}

/** Collects the node and all of its descendants (depth-first, parents first). */
export function collectSubtree(project: Project, nodeId: string): DesignNode[] {
  const out: DesignNode[] = [];
  const visit = (id: string) => {
    const n = project.nodes[id];
    if (!n) return;
    out.push(n);
    n.childIds.forEach(visit);
  };
  visit(nodeId);
  return out;
}

/** Removes ids whose ancestor is also in the list (keeps top-most selections). */
export function topLevelOnly(project: Project, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let cur = project.nodes[id];
    let guard = 0;
    while (cur && guard++ < 10_000) {
      if (set.has(cur.parentId)) return false;
      cur = project.nodes[cur.parentId];
    }
    return true;
  });
}

/** True when the node participates in its parent's auto-layout flow. */
export function isInFlow(project: Project, node: DesignNode): boolean {
  const parent = project.nodes[node.parentId];
  return !!parent && parent.type === 'frame' && parent.layout.mode !== 'none' && node.layoutPositioning === 'auto';
}

/** Sorts ids by document order (depth-first traversal). */
export function sortByDocumentOrder(project: Project, ids: string[]): string[] {
  const order = new Map<string, number>();
  let i = 0;
  const visit = (id: string) => {
    order.set(id, i++);
    project.nodes[id]?.childIds.forEach(visit);
  };
  for (const p of project.pages) p.childIds.forEach(visit);
  return [...ids].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}
