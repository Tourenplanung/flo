/**
 * High-level editor commands. They translate user intent into validated document ops
 * and dispatch them as single undoable transactions.
 */
import { createFrame, createGroup, type NodeTree } from '@/core/factory';
import { unionRects, type Point, type Rect } from '@/core/geometry';
import { createId } from '@/core/ids';
import { op, type DocOp } from '@/core/ops';
import { isContainer, type DesignNode, type Project } from '@/core/schema';
import { collectSubtree, getChildIds, isInFlow, sortByDocumentOrder, topLevelOnly } from '@/core/tree';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { getViewport, useEditorStore } from '@/store/editorStore';

const editor = () => useEditorStore.getState();

/* ------------------------------------------------------------------ */
/* Coordinate helpers                                                  */
/* ------------------------------------------------------------------ */

/** World-space origin used for absolute children of a parent (inside its border). */
export function parentOrigin(project: Project, parentId: string): Point {
  const parent = project.nodes[parentId];
  if (!parent) return { x: 0, y: 0 };
  const r = editor().rects[parentId];
  const border = parent.stroke?.visible && parent.type !== 'line' ? parent.stroke.width : 0;
  return { x: (r?.x ?? 0) + border, y: (r?.y ?? 0) + border };
}

export function worldToLocal(project: Project, parentId: string, p: Point): Point {
  const o = parentOrigin(project, parentId);
  return { x: p.x - o.x, y: p.y - o.y };
}

/** World rect of a node: measured from the DOM when available, otherwise derived from x/y. */
export function worldRect(project: Project, id: string): Rect | null {
  const measured = editor().rects[id];
  if (measured) return measured;
  const n = project.nodes[id];
  if (!n) return null;
  const o = parentOrigin(project, n.parentId);
  return { x: o.x + n.x, y: o.y + n.y, width: n.width, height: n.height };
}

export function viewportCenterWorld(): Point {
  const vp = getViewport();
  const el = document.querySelector('[data-canvas-root]');
  const w = el?.clientWidth ?? 1200;
  const h = el?.clientHeight ?? 800;
  return { x: (w / 2 - vp.x) / vp.zoom, y: (h / 2 - vp.y) / vp.zoom };
}

/* ------------------------------------------------------------------ */
/* Cloning                                                             */
/* ------------------------------------------------------------------ */

/** Deep-clones a subtree with fresh ids. Returns nodes root-first. */
export function cloneSubtree(source: Record<string, DesignNode>, rootId: string, newParentId: string): DesignNode[] {
  const idMap = new Map<string, string>();
  const order: DesignNode[] = [];
  const visit = (id: string) => {
    const n = source[id];
    if (!n) return;
    idMap.set(id, createId());
    order.push(n);
    n.childIds.forEach(visit);
  };
  visit(rootId);
  return order.map((n) => {
    const copy = structuredClone(n) as DesignNode;
    copy.id = idMap.get(n.id)!;
    copy.parentId = n.id === rootId ? newParentId : idMap.get(n.parentId)!;
    copy.childIds = n.childIds.map((c) => idMap.get(c)!).filter(Boolean);
    return copy;
  });
}

/* ------------------------------------------------------------------ */
/* Insertion                                                           */
/* ------------------------------------------------------------------ */

/** Finds the best container for inserting new content: selected frame, its parent, or the frame under the view center. */
export function resolveInsertTarget(project: Project): string {
  const pageId = editor().pageId!;
  const sel = editor().selection.map((id) => project.nodes[id]).filter(Boolean) as DesignNode[];
  const first = sel[0];
  if (first) {
    if (first.type === 'frame') return first.id;
    if (project.nodes[first.parentId]) return first.parentId;
  }
  const c = viewportCenterWorld();
  const page = project.pages.find((p) => p.id === pageId);
  const top = [...(page?.childIds ?? [])].reverse().find((id) => {
    const n = project.nodes[id];
    const r = editor().rects[id];
    return n?.type === 'frame' && n.visible && r && c.x >= r.x && c.x <= r.x + r.width && c.y >= r.y && c.y <= r.y + r.height;
  });
  return top ?? pageId;
}

/**
 * Inserts a prepared node tree under `parentId`. For absolute placement in a container,
 * the root is positioned at `world` (or centered in the view / parent).
 */
export function insertTree(tree: NodeTree, parentId: string, world?: Point, label = 'Insert'): boolean {
  const project = getProject();
  if (!project) return false;
  const root = tree.root;
  root.parentId = parentId;
  const parent = project.nodes[parentId];
  const flowParent = parent?.type === 'frame' && parent.layout.mode !== 'none';
  if (flowParent && !world) {
    root.layoutPositioning = 'auto';
  } else {
    root.layoutPositioning = flowParent ? 'absolute' : root.layoutPositioning === 'auto' ? 'absolute' : root.layoutPositioning;
    if (root.sizing.horizontal === 'fill') root.sizing = { ...root.sizing, horizontal: 'fixed' };
    if (root.sizing.vertical === 'fill') root.sizing = { ...root.sizing, vertical: 'fixed' };
    let target = world;
    if (!target) {
      const pr = parent ? worldRect(project, parentId) : null;
      const center = pr ? { x: pr.x + pr.width / 2, y: pr.y + pr.height / 2 } : viewportCenterWorld();
      target = { x: center.x - root.width / 2, y: center.y - root.height / 2 };
      if (pr) target = { x: Math.max(pr.x, target.x), y: Math.max(pr.y, target.y) };
    }
    const local = worldToLocal(project, parentId, target);
    root.x = Math.round(local.x);
    root.y = Math.round(local.y);
  }
  const res = dispatch([op.insert(tree.nodes)], { label, selectionAfter: [root.id] });
  if (res.ok) {
    editor().select([root.id]);
    editor().setTool('select');
  } else editor().showToast(res.error, 'error');
  return res.ok;
}

/* ------------------------------------------------------------------ */
/* Selection commands                                                  */
/* ------------------------------------------------------------------ */

function selectedTopLevel(project: Project): string[] {
  return topLevelOnly(project, editor().selection.filter((id) => project.nodes[id]));
}

export function deleteSelection() {
  const project = getProject();
  if (!project) return;
  const ids = selectedTopLevel(project);
  if (!ids.length) return;
  const res = dispatch(ids.map(op.remove), { label: 'Delete', selectionAfter: [] });
  if (res.ok) editor().select([]);
}

export function duplicateSelection(offset = 20) {
  const project = getProject();
  if (!project) return;
  const ids = sortByDocumentOrder(project, selectedTopLevel(project));
  if (!ids.length) return;
  const ops: DocOp[] = [];
  const newIds: string[] = [];
  for (const id of ids) {
    const n = project.nodes[id]!;
    const nodes = cloneSubtree(project.nodes, id, n.parentId);
    const root = nodes[0]!;
    if (!isInFlow(project, n)) {
      root.x += offset;
      root.y += offset;
    }
    root.name = n.name;
    const index = getChildIds(project, n.parentId).indexOf(id) + 1;
    ops.push(op.insert(nodes, index));
    newIds.push(root.id);
  }
  const res = dispatch(ops, { label: 'Duplicate', selectionAfter: newIds });
  if (res.ok) editor().select(newIds);
}

/* ---------------- clipboard (in-memory, survives page switches) ---------------- */

interface ClipboardData {
  roots: string[];
  nodes: Record<string, DesignNode>;
}
let clipboard: ClipboardData | null = null;

export function copySelection() {
  const project = getProject();
  if (!project) return;
  const roots = sortByDocumentOrder(project, selectedTopLevel(project));
  if (!roots.length) return;
  const nodes: Record<string, DesignNode> = {};
  for (const r of roots) for (const n of collectSubtree(project, r)) nodes[n.id] = structuredClone(n);
  clipboard = { roots, nodes };
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

export function pasteClipboard() {
  const project = getProject();
  if (!project || !clipboard) return;
  const sel = editor().selection.map((id) => project.nodes[id]).filter(Boolean) as DesignNode[];
  const selectedFrame = sel.length === 1 && sel[0]!.type === 'frame' && !clipboard.roots.includes(sel[0]!.id) ? sel[0]! : null;
  const ops: DocOp[] = [];
  const newIds: string[] = [];
  for (const rootId of clipboard.roots) {
    const original = clipboard.nodes[rootId]!;
    let parentId = selectedFrame?.id ?? original.parentId;
    if (!project.nodes[parentId] && !project.pages.some((p) => p.id === parentId)) parentId = editor().pageId!;
    // Keep within the current page.
    if (!project.nodes[parentId] && parentId !== editor().pageId) parentId = editor().pageId!;
    const nodes = cloneSubtree(clipboard.nodes, rootId, parentId);
    const root = nodes[0]!;
    const sameParent = parentId === original.parentId;
    if (sameParent) {
      root.x += 20;
      root.y += 20;
    }
    ops.push(op.insert(nodes));
    newIds.push(root.id);
  }
  const res = dispatch(ops, { label: 'Paste', selectionAfter: newIds });
  if (res.ok) editor().select(newIds);
  else editor().showToast(res.error, 'error');
}

/* ---------------- ordering ---------------- */

export function reorderSelection(where: 'front' | 'back' | 'forward' | 'backward') {
  const project = getProject();
  if (!project) return;
  const ids = selectedTopLevel(project);
  const ops: DocOp[] = [];
  // Process siblings in an order that keeps relative ordering stable.
  const ordered = sortByDocumentOrder(project, ids);
  // Front/backward: ascending order; back/forward: descending — keeps relative order stable.
  const seq = where === 'front' || where === 'backward' ? ordered : [...ordered].reverse();
  const sim = structuredClone(project);
  for (const id of seq) {
    const n = sim.nodes[id]!;
    const list = getChildIds(sim, n.parentId);
    const i = list.indexOf(id);
    let target = i;
    if (where === 'front') target = list.length - 1;
    if (where === 'back') target = 0;
    if (where === 'forward') target = Math.min(list.length - 1, i + 1);
    if (where === 'backward') target = Math.max(0, i - 1);
    if (target === i) continue;
    list.splice(i, 1);
    list.splice(target, 0, id);
    ops.push(op.move(id, n.parentId, target));
  }
  if (ops.length) dispatch(ops, { label: 'Reorder' });
}

/* ---------------- grouping ---------------- */

export function groupSelection(kind: 'group' | 'frame' = 'group') {
  const project = getProject();
  if (!project) return;
  const ids = sortByDocumentOrder(project, selectedTopLevel(project));
  if (!ids.length) return;
  const parentId = project.nodes[ids[0]!]!.parentId;
  if (ids.some((id) => project.nodes[id]!.parentId !== parentId)) {
    editor().showToast('Seleziona livelli con lo stesso genitore / Select layers with the same parent', 'error');
    return;
  }
  const rects = ids.map((id) => worldRect(project, id)).filter(Boolean) as Rect[];
  const bounds = unionRects(rects);
  if (!bounds) return;
  const local = worldToLocal(project, parentId, bounds);
  const parent = project.nodes[parentId];
  const parentFlow = parent?.type === 'frame' && parent.layout.mode !== 'none';
  const container =
    kind === 'group'
      ? createGroup({ parentId, x: Math.round(local.x), y: Math.round(local.y), width: bounds.width, height: bounds.height })
      : createFrame({ parentId, x: Math.round(local.x), y: Math.round(local.y), width: bounds.width, height: bounds.height }, { fills: [], clipContent: false });
  if (parentFlow) container.layoutPositioning = 'auto';
  const list = getChildIds(project, parentId);
  const index = Math.max(...ids.map((id) => list.indexOf(id))) - ids.length + 1;
  const ops: DocOp[] = [op.insert([container], index + ids.length)];
  ids.forEach((id, i) => {
    const r = worldRect(project, id)!;
    ops.push(op.move(id, container.id, i));
    ops.push(op.update(id, { x: Math.round(r.x - bounds.x), y: Math.round(r.y - bounds.y), layoutPositioning: 'absolute' }));
  });
  const res = dispatch(ops, { label: kind === 'group' ? 'Group' : 'Frame selection', selectionAfter: [container.id] });
  if (res.ok) editor().select([container.id]);
  else editor().showToast(res.error, 'error');
}

export function ungroupSelection() {
  const project = getProject();
  if (!project) return;
  const groups = editor()
    .selection.map((id) => project.nodes[id])
    .filter((n): n is DesignNode => !!n && isContainer(n) && n.childIds.length > 0);
  if (!groups.length) return;
  const ops: DocOp[] = [];
  const released: string[] = [];
  for (const g of groups) {
    const list = getChildIds(project, g.parentId);
    let index = list.indexOf(g.id);
    const gr = worldRect(project, g.id);
    const origin = parentOrigin(project, g.parentId);
    const parentFlow = (() => {
      const p = project.nodes[g.parentId];
      return p?.type === 'frame' && p.layout.mode !== 'none';
    })();
    for (const c of g.childIds) {
      const r = worldRect(project, c) ?? (gr ? { ...gr } : null);
      ops.push(op.move(c, g.parentId, index++));
      if (r) {
        ops.push(
          op.update(c, {
            x: Math.round(r.x - origin.x),
            y: Math.round(r.y - origin.y),
            layoutPositioning: parentFlow ? g.layoutPositioning : 'absolute',
          }),
        );
      }
      released.push(c);
    }
    ops.push(op.remove(g.id));
  }
  const res = dispatch(ops, { label: 'Ungroup', selectionAfter: released });
  if (res.ok) editor().select(released);
}

/* ---------------- movement ---------------- */

export function nudgeSelection(dx: number, dy: number) {
  const project = getProject();
  if (!project) return;
  const ops: DocOp[] = [];
  for (const id of selectedTopLevel(project)) {
    const n = project.nodes[id]!;
    if (n.locked || isInFlow(project, n)) continue;
    ops.push(op.update(id, { x: n.x + dx, y: n.y + dy }));
  }
  if (ops.length) dispatch(ops, { label: 'Nudge', mergeKey: 'nudge' });
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignSelection(mode: AlignMode) {
  const project = getProject();
  if (!project) return;
  const ids = selectedTopLevel(project).filter((id) => !isInFlow(project, project.nodes[id]!));
  if (!ids.length) return;
  let bounds: Rect | null;
  if (ids.length === 1) {
    const n = project.nodes[ids[0]!]!;
    if (!project.nodes[n.parentId]) return;
    const pr = worldRect(project, n.parentId);
    const o = parentOrigin(project, n.parentId);
    bounds = pr ? { x: o.x, y: o.y, width: pr.width - 2 * (o.x - pr.x), height: pr.height - 2 * (o.y - pr.y) } : null;
  } else bounds = unionRects(ids.map((id) => worldRect(project, id)).filter(Boolean) as Rect[]);
  if (!bounds) return;
  const ops: DocOp[] = [];
  for (const id of ids) {
    const n = project.nodes[id]!;
    const r = worldRect(project, id);
    if (!r) continue;
    let x = r.x;
    let y = r.y;
    if (mode === 'left') x = bounds.x;
    if (mode === 'hcenter') x = bounds.x + bounds.width / 2 - r.width / 2;
    if (mode === 'right') x = bounds.x + bounds.width - r.width;
    if (mode === 'top') y = bounds.y;
    if (mode === 'vcenter') y = bounds.y + bounds.height / 2 - r.height / 2;
    if (mode === 'bottom') y = bounds.y + bounds.height - r.height;
    ops.push(op.update(id, { x: Math.round(n.x + (x - r.x)), y: Math.round(n.y + (y - r.y)) }));
  }
  dispatch(ops, { label: 'Align' });
}

/* ---------------- selection navigation ---------------- */

export function selectAll() {
  const project = getProject();
  const s = editor();
  if (!project || !s.pageId) return;
  const first = s.selection[0] ? project.nodes[s.selection[0]] : undefined;
  const parentId = first ? first.parentId : s.pageId;
  s.select(getChildIds(project, parentId).filter((id) => !project.nodes[id]?.locked && project.nodes[id]?.visible));
}

export function selectParent() {
  const project = getProject();
  const s = editor();
  if (!project) return;
  if (s.editingTextId) return s.setEditingText(null);
  const first = s.selection[0] ? project.nodes[s.selection[0]] : undefined;
  if (first && project.nodes[first.parentId]) s.select([first.parentId]);
  else s.select([]);
}

export function selectChildren() {
  const project = getProject();
  const s = editor();
  if (!project) return;
  const first = s.selection[0] ? project.nodes[s.selection[0]] : undefined;
  if (!first) return;
  if (first.type === 'text' && s.selection.length === 1) return s.setEditingText(first.id);
  if (first.childIds.length) s.select([...first.childIds]);
}

export function toggleVisibility(ids = editor().selection) {
  const project = getProject();
  if (!project) return;
  const nodes = ids.map((id) => project.nodes[id]).filter(Boolean) as DesignNode[];
  if (!nodes.length) return;
  const visible = !nodes.every((n) => n.visible);
  dispatch(nodes.map((n) => op.update(n.id, { visible })), { label: visible ? 'Show' : 'Hide' });
}

export function toggleLock(ids = editor().selection) {
  const project = getProject();
  if (!project) return;
  const nodes = ids.map((id) => project.nodes[id]).filter(Boolean) as DesignNode[];
  if (!nodes.length) return;
  const locked = !nodes.every((n) => n.locked);
  const res = dispatch(nodes.map((n) => op.update(n.id, { locked })), { label: locked ? 'Lock' : 'Unlock' });
  if (res.ok && locked) editor().select([]);
}

/* ---------------- updates ---------------- */

/** Updates a property on every selected node (one undo step per field while typing). */
export function updateNodes(ids: string[], props: Partial<DesignNode> | ((n: DesignNode) => Partial<DesignNode>), mergeKey?: string) {
  const project = getProject();
  if (!project) return;
  const ops = ids
    .map((id) => project.nodes[id])
    .filter(Boolean)
    .map((n) => op.update(n!.id, typeof props === 'function' ? props(n!) : props));
  if (!ops.length) return;
  const res = dispatch(ops, { label: 'Edit', mergeKey: mergeKey ? `${mergeKey}:${ids.join(',')}` : undefined });
  if (!res.ok) editor().showToast(res.error, 'error');
}

export function undo() {
  useDocStore.getState().undo();
}
export function redo() {
  useDocStore.getState().redo();
}
