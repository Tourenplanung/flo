import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createEllipse, createFrame, createLine, createRect, createText } from '@/core/factory';
import {
  buildSnapTargets,
  normalizeRect,
  rectsIntersect,
  resizeRect,
  snapRect,
  unionRects,
  type HandleDir,
  type Point,
  type Rect,
} from '@/core/geometry';
import { createId } from '@/core/ids';
import { op, type DocOp } from '@/core/ops';
import type { DesignNode, Guide, Project } from '@/core/schema';
import { getChildIds, getNodePath, isAncestor, isInFlow, topLevelOnly } from '@/core/tree';
import { parentOrigin, worldRect, writeOps } from '@/editor/actions';
import { activeChain, effectiveNode, useChain } from '@/editor/effective';
import { constraintOps } from '@/core/constraints';
import { parseVirtualId } from '@/core/instance';
import { importAndInsertImages } from '@/editor/imageImport';
import { useT } from '@/i18n';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { getViewport, useEditorStore, useViewport, type Tool } from '@/store/editorStore';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { NodeView } from './NodeView';
import { Overlay } from './Overlay';
import { Rulers, RULER_SIZE } from './Rulers';
import { BreakpointBar } from './BreakpointBar';
import { LinkPrompt } from './LinkPrompt';

type Gesture =
  | { kind: 'pan'; start: Point; vp: { x: number; y: number } }
  | { kind: 'marquee'; start: Point; scopeId: string; additive: boolean; base: string[] }
  | {
      kind: 'move';
      startClient: Point;
      start: Point;
      started: boolean;
      key: string;
      items: { id: string; x: number; y: number; rect: Rect }[];
      flowId: string | null;
      bounds: Rect;
      parentId: string;
    }
  | { kind: 'resize'; id: string; dir: HandleDir; start: Point; rect: Rect; key: string }
  | { kind: 'draw'; tool: Tool; start: Point; startClient: Point; parentId: string; createdId: string | null; key: string }
  | { kind: 'guide'; guideId: string; axis: 'x' | 'y'; key: string }
  | { kind: 'link'; sourceId: string };

const DRAW_TOOLS: Tool[] = ['frame', 'rect', 'ellipse', 'line', 'text'];
const DRAG_THRESHOLD = 3;

let gestureSeq = 0;
const nextKey = (kind: string) => `${kind}-${++gestureSeq}-${Date.now()}`;

/** Deepest unlocked path from top-level down to the hit node (virtual instance layers map to their instance). */
function hitPath(project: Project, hitId: string): DesignNode[] {
  const path = getNodePath(project, parseVirtualId(hitId)?.instanceId ?? hitId);
  const lockedAt = path.findIndex((n) => n.locked);
  return lockedAt >= 0 ? path.slice(0, lockedAt) : path;
}

/** Figma-like selection depth: keeps the click at the level of the current selection context. */
function pickTarget(project: Project, path: DesignNode[], selection: string[], deep: boolean): string | null {
  if (!path.length) return null;
  if (deep) return path[path.length - 1]!.id;
  const selectedIdx = path.findIndex((n) => selection.includes(n.id));
  // Keep a selected container when clicking its content (so it can be dragged), except for
  // top-level frames (artboards): clicking inside them selects their direct children.
  const isArtboard = selectedIdx === 0 && path[0]!.type === 'frame' && path.length > 1;
  if (selectedIdx >= 0 && !isArtboard) return path[selectedIdx]!.id;
  let depth = path[0]!.type === 'frame' && path.length > 1 ? 1 : 0;
  for (const s of selection) {
    const sn = project.nodes[s];
    if (!sn) continue;
    path.forEach((n, i) => {
      if (n.parentId === sn.parentId || n.parentId === sn.id) depth = Math.max(depth, i);
    });
  }
  return path[Math.min(depth, path.length - 1)]!.id;
}

function nodeIdFromTarget(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.('[data-node-id]');
  return el?.getAttribute('data-node-id') ?? null;
}

/** Hit-tests design nodes at a client point (pointer capture retargets click events to the root). */
function nodeIdAtPoint(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest('[data-canvas-world] [data-node-id]')?.getAttribute('data-node-id');
    if (id) return id;
  }
  return null;
}

/** Screen (top-level frame) under a client point that a prototype link from `sourceId` may target. */
function linkTargetAt(project: Project, sourceId: string, x: number, y: number): string | null {
  const hit = nodeIdAtPoint(x, y);
  if (!hit) return null;
  const real = parseVirtualId(hit)?.instanceId ?? hit;
  const screen = getNodePath(project, real)[0];
  if (!screen || screen.type !== 'frame') return null;
  const sourceScreen = getNodePath(project, sourceId)[0];
  if (screen.id === sourceScreen?.id) return null;
  return screen.id;
}

/** Container under a client point, ignoring the given nodes (and their subtrees). */
function containerAt(project: Project, pageId: string, client: Point, exclude: Set<string>): string {
  const els = document.elementsFromPoint(client.x, client.y);
  for (const el of els) {
    const id = el.closest('[data-node-id]')?.getAttribute('data-node-id');
    if (!id || !project.nodes[id]) continue;
    const path = hitPath(project, id);
    for (let i = path.length - 1; i >= 0; i--) {
      const n = path[i]!;
      if (exclude.has(n.id) || [...exclude].some((ex) => isAncestor(project, ex, n.id))) continue;
      if (n.type === 'frame') return n.id;
    }
  }
  return pageId;
}

/** Index within an auto-layout parent for a pointer position. */
function flowIndexAt(project: Project, parentId: string, world: Point, excludeId?: string): number {
  const parent = project.nodes[parentId];
  if (!parent || parent.type !== 'frame') return 0;
  const horizontal = parent.layout.mode === 'horizontal';
  const siblings = parent.childIds.filter((id) => id !== excludeId && project.nodes[id]?.layoutPositioning !== 'absolute');
  let index = 0;
  for (const id of siblings) {
    const r = useEditorStore.getState().rects[id];
    if (!r) continue;
    const center = horizontal ? r.x + r.width / 2 : r.y + r.height / 2;
    if ((horizontal ? world.x : world.y) > center) index++;
  }
  // Translate from "flow siblings" index to childIds index.
  const flowIds = siblings;
  if (index >= flowIds.length) return parent.childIds.filter((id) => id !== excludeId).length;
  const anchor = flowIds[index]!;
  return parent.childIds.filter((id) => id !== excludeId).indexOf(anchor);
}

/** Ops that refit groups to their children after a change (groups have no own size semantics). */
function fitGroupOps(project: Project, overrides: Record<string, Rect>): DocOp[] {
  const ops: DocOp[] = [];
  const groups = new Set<string>();
  for (const id of Object.keys(overrides)) {
    const parent = project.nodes[project.nodes[id]?.parentId ?? ''];
    if (parent?.type === 'group') groups.add(parent.id);
  }
  for (const gid of groups) {
    const g = project.nodes[gid]!;
    const rects = g.childIds.map((c) => overrides[c] ?? worldRect(project, c)).filter(Boolean) as Rect[];
    const b = unionRects(rects);
    const gr = worldRect(project, gid);
    if (!b || !gr) continue;
    const dx = b.x - gr.x;
    const dy = b.y - gr.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(b.width - g.width) < 0.01 && Math.abs(b.height - g.height) < 0.01) continue;
    ops.push(op.update(gid, { x: Math.round((g.x + dx) * 100) / 100, y: Math.round((g.y + dy) * 100) / 100, width: b.width, height: b.height }));
    for (const c of g.childIds) {
      const cn = project.nodes[c]!;
      const r = overrides[c];
      if (r) {
        ops.push(op.update(c, { x: Math.round((r.x - b.x) * 100) / 100, y: Math.round((r.y - b.y) * 100) / 100 }));
      } else ops.push(op.update(c, { x: cn.x - dx, y: cn.y - dy }));
    }
  }
  return ops;
}

export function Canvas() {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const pageId = useEditorStore((s) => s.pageId);
  const tool = useEditorStore((s) => s.tool);
  const showRulers = useEditorStore((s) => s.showRulers);
  const vp = useViewport();
  const chain = useChain();
  const page = useDocStore((s) => s.project?.pages.find((p) => p.id === pageId));
  const nodes = useDocStore((s) => s.project?.nodes);

  /* ---------------- coordinate conversion ---------------- */

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = rootRef.current!.getBoundingClientRect();
    const v = getViewport();
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }, []);

  /* ---------------- measurement ---------------- */

  const measure = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const zoom = getViewport().zoom;
    const wr = world.getBoundingClientRect();
    const rects: Record<string, Rect> = {};
    world.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height && el.style.display === 'none') return;
      rects[el.dataset.nodeId!] = {
        x: (r.left - wr.left) / zoom,
        y: (r.top - wr.top) / zoom,
        width: r.width / zoom,
        height: r.height / zoom,
      };
    });
    useEditorStore.getState().setRects(rects);
  }, []);

  useLayoutEffect(measure, [measure, nodes, page, vp.zoom, chain]);

  useEffect(() => {
    const handler = () => requestAnimationFrame(measure);
    window.addEventListener('flo:remeasure', handler);
    document.fonts?.addEventListener?.('loadingdone', handler);
    void document.fonts?.ready.then(handler);
    return () => {
      window.removeEventListener('flo:remeasure', handler);
      document.fonts?.removeEventListener?.('loadingdone', handler);
    };
  }, [measure]);

  /* ---------------- wheel: pan & zoom ---------------- */

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = getViewport();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 2.5 : 1));
        const zoom = Math.min(64, Math.max(0.02, v.zoom * factor));
        const k = zoom / v.zoom;
        useEditorStore.getState().setViewport({ zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k });
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        useEditorStore.getState().setViewport({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* ---------------- space-to-pan ---------------- */

  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName));
    };
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceDown(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /* ---------------- gesture start helpers ---------------- */

  const startMove = useCallback(
    (clientX: number, clientY: number) => {
      const project = getProject()!;
      const ids = topLevelOnly(project, useEditorStore.getState().selection).filter((id) => {
        const n = project.nodes[id];
        return n && !n.locked;
      });
      if (!ids.length) return;
      const flowItems = ids.filter((id) => isInFlow(project, project.nodes[id]!));
      const flowId = ids.length === 1 && flowItems.length === 1 ? ids[0]! : null;
      const movable = flowId ? ids : ids.filter((id) => !flowItems.includes(id));
      const chain = activeChain(project);
      const items = movable.map((id) => {
        const n = effectiveNode(project, id, chain)!;
        return { id, x: n.x, y: n.y, rect: worldRect(project, id) ?? { x: 0, y: 0, width: 0, height: 0 } };
      });
      if (!items.length) return;
      gestureRef.current = {
        kind: 'move',
        startClient: { x: clientX, y: clientY },
        start: toWorld(clientX, clientY),
        started: false,
        key: nextKey('move'),
        items,
        flowId,
        bounds: unionRects(items.map((i) => i.rect))!,
        parentId: project.nodes[items[0]!.id]!.parentId,
      };
    },
    [toWorld],
  );

  const onHandleDown = useCallback(
    (e: RPointerEvent, dir: HandleDir) => {
      e.stopPropagation();
      const project = getProject()!;
      const id = useEditorStore.getState().selection[0];
      if (!id || project.nodes[id]?.locked) return;
      const rect = worldRect(project, id);
      if (!rect) return;
      rootRef.current?.setPointerCapture(e.pointerId);
      gestureRef.current = { kind: 'resize', id, dir, start: toWorld(e.clientX, e.clientY), rect, key: nextKey('resize') };
    },
    [toWorld],
  );

  const onFrameLabelDown = useCallback(
    (e: RPointerEvent, id: string) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      const s = useEditorStore.getState();
      if (e.shiftKey) s.toggleSelect(id);
      else if (!s.selection.includes(id)) s.select([id]);
      rootRef.current?.setPointerCapture(e.pointerId);
      startMove(e.clientX, e.clientY);
    },
    [startMove],
  );

  const onLinkHandleDown = useCallback((e: RPointerEvent, sourceId: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    rootRef.current?.setPointerCapture(e.pointerId);
    useEditorStore.getState().setLinkPrompt(null);
    gestureRef.current = { kind: 'link', sourceId };
  }, []);

  const onGuideDown = useCallback((e: RPointerEvent, guide: Guide) => {
    e.stopPropagation();
    rootRef.current?.setPointerCapture(e.pointerId);
    gestureRef.current = { kind: 'guide', guideId: guide.id, axis: guide.axis, key: nextKey('guide') };
  }, []);

  const onRulerDown = useCallback((e: RPointerEvent, axis: 'x' | 'y') => {
    const project = getProject();
    const pid = useEditorStore.getState().pageId;
    const pg = project?.pages.find((p) => p.id === pid);
    if (!pg) return;
    e.preventDefault();
    rootRef.current?.setPointerCapture(e.pointerId);
    const guide: Guide = { id: createId(), axis, position: -100000 };
    const key = nextKey('guide');
    dispatch([{ type: 'updatePage', id: pg.id, props: { guides: [...pg.guides, guide] } }], { label: 'Add guide', mergeKey: key, mergeWindow: Infinity });
    gestureRef.current = { kind: 'guide', guideId: guide.id, axis, key };
  }, []);

  /* ---------------- pointer handlers ---------------- */

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const s = useEditorStore.getState();
    const project = getProject();
    if (!project || !s.pageId) return;
    setMenu(null);
    if ((e.target as HTMLElement).closest('[data-text-editor]')) return;
    if (s.editingTextId) s.setEditingText(null);
    (document.activeElement as HTMLElement | null)?.blur?.();
    const client = { x: e.clientX, y: e.clientY };
    const world = toWorld(e.clientX, e.clientY);

    if (e.button === 1 || spaceDown || s.tool === 'hand') {
      e.preventDefault();
      rootRef.current!.setPointerCapture(e.pointerId);
      const v = getViewport();
      gestureRef.current = { kind: 'pan', start: client, vp: { x: v.x, y: v.y } };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;
    rootRef.current!.setPointerCapture(e.pointerId);
    const hitId = nodeIdFromTarget(e.target);
    const path = hitId ? hitPath(project, hitId) : [];

    if (DRAW_TOOLS.includes(s.tool)) {
      let parentId = s.pageId;
      for (let i = path.length - 1; i >= 0; i--) {
        if (path[i]!.type === 'frame') {
          parentId = path[i]!.id;
          break;
        }
      }
      gestureRef.current = { kind: 'draw', tool: s.tool, start: world, startClient: client, parentId, createdId: null, key: nextKey('draw') };
      return;
    }

    // Select tool
    const deep = e.metaKey || e.ctrlKey;
    const isTopFrameBackground = path.length === 1 && path[0]!.type === 'frame' && !s.selection.includes(path[0]!.id) && !deep;
    let target = isTopFrameBackground ? null : pickTarget(project, path, s.selection, deep);
    // Inside an instance: ⌘/Ctrl-click, or clicking while one of its layers is selected, reaches the inner layer.
    const v = hitId ? parseVirtualId(hitId) : null;
    if (v && hitId && (deep || s.selection.some((id) => parseVirtualId(id)?.instanceId === v.instanceId))) target = hitId;
    if (!target) {
      const scopeId = isTopFrameBackground ? path[0]!.id : s.pageId;
      if (!e.shiftKey) s.select([]);
      gestureRef.current = { kind: 'marquee', start: world, scopeId, additive: e.shiftKey, base: e.shiftKey ? s.selection : [] };
      return;
    }
    if (e.shiftKey) {
      s.toggleSelect(target);
      if (!useEditorStore.getState().selection.includes(target)) return;
    } else if (!s.selection.includes(target)) s.select([target]);
    startMove(e.clientX, e.clientY);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const s = useEditorStore.getState();
    const project = getProject();
    if (!project) return;
    if (!g) {
      if (s.tool === 'select' && !spaceDown) {
        const hitId = nodeIdFromTarget(e.target);
        const path = hitId ? hitPath(project, hitId) : [];
        const target = pickTarget(project, path, s.selection, e.metaKey || e.ctrlKey);
        s.setHovered(target);
      }
      return;
    }
    const world = toWorld(e.clientX, e.clientY);
    if (g.kind === 'link') {
      s.setLinkDrag({ sourceId: g.sourceId, to: world, targetId: linkTargetAt(project, g.sourceId, e.clientX, e.clientY) });
      return;
    }
    const zoom = getViewport().zoom;
    const threshold = 6 / zoom;
    const page = project.pages.find((p) => p.id === s.pageId)!;

    switch (g.kind) {
      case 'pan': {
        const v = getViewport();
        s.setViewport({ ...v, x: g.vp.x + e.clientX - g.start.x, y: g.vp.y + e.clientY - g.start.y });
        return;
      }
      case 'marquee': {
        const r = normalizeRect(g.start, world);
        s.setMarquee(r);
        const candidates = getChildIds(project, g.scopeId).filter((id) => {
          const n = project.nodes[id];
          const nr = s.rects[id];
          return n && !n.locked && n.visible && nr && rectsIntersect(r, nr);
        });
        s.select(g.additive ? [...new Set([...g.base, ...candidates])] : candidates);
        return;
      }
      case 'move': {
        if (!g.started) {
          if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return;
          g.started = true;
          s.setHovered(null);
        }
        let dx = world.x - g.start.x;
        let dy = world.y - g.start.y;
        if (g.flowId) {
          // Reorder inside the auto-layout parent while the pointer is inside it.
          const parentRect = s.rects[g.parentId];
          const n = project.nodes[g.flowId]!;
          if (parentRect && world.x >= parentRect.x && world.x <= parentRect.x + parentRect.width && world.y >= parentRect.y && world.y <= parentRect.y + parentRect.height) {
            const index = flowIndexAt(project, n.parentId, world, n.id);
            const cur = getChildIds(project, n.parentId).indexOf(n.id);
            if (index !== cur) dispatch([op.move(n.id, n.parentId, index)], { label: 'Reorder', mergeKey: g.key, mergeWindow: Infinity });
          }
          return;
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (s.snapping && !e.altKey) {
          const moving = new Set(g.items.map((i) => i.id));
          const siblings = getChildIds(project, g.parentId).filter((id) => !moving.has(id) && project.nodes[id]?.visible);
          const rects = siblings.map((id) => s.rects[id]).filter(Boolean) as Rect[];
          const pr = s.rects[g.parentId];
          if (pr) rects.push(pr);
          const targets = buildSnapTargets(rects, page.guides);
          const snapped = snapRect({ ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy }, targets, threshold);
          dx += snapped.dx;
          dy += snapped.dy;
          s.setSnapLines(snapped.lines);
        } else s.setSnapLines([]);
        // Positions snap to the pixel grid.
        const ops = g.items.flatMap((it) => writeOps(project, it.id, { x: Math.round(it.x + dx), y: Math.round(it.y + dy) }));
        dispatch(ops, { label: 'Move', mergeKey: g.key, mergeWindow: Infinity });
        return;
      }
      case 'resize': {
        const n = effectiveNode(project, g.id, activeChain(project));
        if (!n) return;
        let r = resizeRect(g.rect, g.dir, world.x - g.start.x, world.y - g.start.y, {
          keepAspect: e.shiftKey || n.type === 'icon',
          fromCenter: e.altKey,
        });
        if (s.snapping && !e.metaKey) {
          const siblings = getChildIds(project, n.parentId).filter((id) => id !== n.id && project.nodes[id]?.visible);
          const rects = siblings.map((id) => s.rects[id]).filter(Boolean) as Rect[];
          const pr = s.rects[n.parentId];
          if (pr) rects.push(pr);
          const targets = buildSnapTargets(rects, page.guides);
          const xEdge = g.dir.includes('e') ? ['end' as const] : g.dir.includes('w') ? ['start' as const] : [];
          const yEdge = g.dir.includes('s') ? ['end' as const] : g.dir.includes('n') ? ['start' as const] : [];
          const sn = snapRect(r, targets, threshold, { x: xEdge, y: yEdge });
          if (sn.dx || sn.dy) {
            r = resizeRect(g.rect, g.dir, world.x - g.start.x + sn.dx, world.y - g.start.y + sn.dy, { fromCenter: e.altKey });
          }
          s.setSnapLines(sn.lines);
        }
        const o = parentOrigin(project, n.parentId);
        const horizontalChanged = /[ew]/.test(g.dir) || e.shiftKey;
        const verticalChanged = /[ns]/.test(g.dir) || e.shiftKey;
        const sizing = {
          horizontal: horizontalChanged ? ('fixed' as const) : n.sizing.horizontal,
          vertical: verticalChanged ? ('fixed' as const) : n.sizing.vertical,
        };
        const props: Partial<DesignNode> = {
          width: Math.max(n.type === 'line' ? 0 : 1, Math.round(r.width)),
          height: Math.max(n.type === 'line' || n.type === 'text' ? 0 : 1, Math.round(r.height)),
          sizing,
        };
        if (!isInFlow(project, n)) {
          props.x = Math.round(r.x - o.x);
          props.y = Math.round(r.y - o.y);
        }
        // Children with constraints follow the resized frame (base layout; breakpoints adapt via CSS).
        const constraintChanges = s.breakpointId ? [] : constraintOps(project, n.id, props.width!, props.height!);
        dispatch([...writeOps(project, n.id, props as Record<string, unknown>), ...constraintChanges, ...fitGroupOps(project, { [n.id]: r })], {
          label: 'Resize',
          mergeKey: g.key,
          mergeWindow: Infinity,
        });
        return;
      }
      case 'draw': {
        if (!g.createdId && Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return;
        let end = world;
        if (e.shiftKey && g.tool !== 'text') {
          const d = Math.max(Math.abs(world.x - g.start.x), Math.abs(world.y - g.start.y));
          end = { x: g.start.x + Math.sign(world.x - g.start.x || 1) * d, y: g.start.y + Math.sign(world.y - g.start.y || 1) * d };
          if (g.tool === 'line') {
            const ang = Math.atan2(world.y - g.start.y, world.x - g.start.x);
            const snapAng = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(world.x - g.start.x, world.y - g.start.y);
            end = { x: g.start.x + Math.cos(snapAng) * len, y: g.start.y + Math.sin(snapAng) * len };
          }
        }
        const r = normalizeRect(g.start, end);
        const o = parentOrigin(project, g.parentId);
        const local = { x: Math.round(r.x - o.x), y: Math.round(r.y - o.y), width: Math.round(r.width), height: Math.round(r.height) };
        if (!g.createdId) {
          const node = createDrawnNode(g.tool, g.parentId, local, project);
          if (g.tool === 'line') (node as Extract<DesignNode, { type: 'line' }>).flip = (end.x - g.start.x) * (end.y - g.start.y) < 0;
          const res = dispatch([op.insert([node])], { label: 'Create', mergeKey: g.key, mergeWindow: Infinity, selectionBefore: s.selection, selectionAfter: [node.id] });
          if (res.ok) {
            g.createdId = node.id;
            s.select([node.id]);
          }
          return;
        }
        const n = project.nodes[g.createdId];
        if (!n) return;
        const props: Partial<DesignNode> = { width: Math.max(1, local.width), height: Math.max(g.tool === 'line' ? 0 : 1, local.height) };
        if (!isInFlow(project, n)) Object.assign(props, { x: local.x, y: local.y });
        if (n.type === 'line') Object.assign(props, { flip: (end.x - g.start.x) * (end.y - g.start.y) < 0 });
        dispatch([op.update(n.id, props)], { label: 'Create', mergeKey: g.key, mergeWindow: Infinity });
        return;
      }
      case 'guide': {
        const pos = Math.round(g.axis === 'x' ? world.x : world.y);
        const guides = page.guides.map((gd) => (gd.id === g.guideId ? { ...gd, position: pos } : gd));
        dispatch([{ type: 'updatePage', id: page.id, props: { guides } }], { label: 'Move guide', mergeKey: g.key, mergeWindow: Infinity });
        return;
      }
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    const s = useEditorStore.getState();
    s.setSnapLines([]);
    s.setMarquee(null);
    setPanning(false);
    if (rootRef.current?.hasPointerCapture(e.pointerId)) rootRef.current.releasePointerCapture(e.pointerId);
    const project = getProject();
    if (!g || !project || !s.pageId) return;
    const world = toWorld(e.clientX, e.clientY);

    if (g.kind === 'link') {
      s.setLinkDrag(null);
      const destinationId = linkTargetAt(project, g.sourceId, e.clientX, e.clientY);
      const box = rootRef.current?.getBoundingClientRect();
      if (destinationId && box) s.setLinkPrompt({ sourceId: g.sourceId, destinationId, x: e.clientX - box.left, y: e.clientY - box.top });
      return;
    }

    if (g.kind === 'draw') {
      s.setTool('select');
      if (!g.createdId) {
        // Click without drag: create with a default size.
        const o = parentOrigin(project, g.parentId);
        const size = g.tool === 'line' ? { width: 100, height: 0 } : { width: 100, height: 100 };
        const local = { x: Math.round(world.x - o.x), y: Math.round(world.y - o.y), ...size };
        const node = createDrawnNode(g.tool, g.parentId, local, project);
        if (g.tool === 'text') node.sizing = { horizontal: 'hug', vertical: 'hug' };
        const res = dispatch([op.insert([node])], { label: 'Create', mergeKey: `create-text:${node.id}`, mergeWindow: Infinity, selectionAfter: [node.id] });
        if (res.ok) {
          s.select([node.id]);
          if (g.tool === 'text') s.setEditingText(node.id);
        }
      } else if (g.tool === 'text') {
        // Re-key the creation entry so the first text edit merges with it (one undo step).
        const createdId = g.createdId;
        useDocStore.setState((st) => {
          const last = st.past[st.past.length - 1];
          return last ? { past: [...st.past.slice(0, -1), { ...last, mergeKey: `create-text:${createdId}` }] } : {};
        });
        s.setEditingText(createdId);
      } else useDocStore.getState().sealHistory();
      return;
    }

    if (g.kind === 'guide') {
      // Dropping a guide back on the ruler removes it.
      const r = rootRef.current!.getBoundingClientRect();
      const local = g.axis === 'y' ? e.clientY - r.top : e.clientX - r.left;
      const page = project.pages.find((p) => p.id === s.pageId)!;
      if (local < RULER_SIZE && s.showRulers) {
        dispatch([{ type: 'updatePage', id: page.id, props: { guides: page.guides.filter((gd) => gd.id !== g.guideId) } }], {
          label: 'Remove guide',
          mergeKey: g.key,
          mergeWindow: Infinity,
        });
      }
      return;
    }

    if (g.kind === 'move' && g.started) {
      const moving = new Set(g.items.map((i) => i.id));
      const target = containerAt(project, s.pageId, { x: e.clientX, y: e.clientY }, moving);
      const allowReparent = !e.altKey;
      if (allowReparent && target !== g.parentId) {
        // Reparent: preserve world position (or join the target's auto-layout flow).
        const tNode = project.nodes[target];
        const flow = tNode?.type === 'frame' && tNode.layout.mode !== 'none';
        const o = parentOrigin(project, target);
        const ops: DocOp[] = [];
        let index = flow ? flowIndexAt(project, target, world) : undefined;
        for (const it of g.items) {
          const r = s.rects[it.id] ?? it.rect;
          ops.push(op.move(it.id, target, index));
          if (index !== undefined) index++;
          const n = project.nodes[it.id]!;
          const props: Partial<DesignNode> = {
            x: Math.round(r.x - o.x),
            y: Math.round(r.y - o.y),
            layoutPositioning: flow ? 'auto' : 'absolute',
          };
          if (!flow) {
            props.width = Math.round(r.width * 100) / 100;
            props.height = Math.round(r.height * 100) / 100;
            if (n.sizing.horizontal === 'fill') props.sizing = { ...n.sizing, horizontal: 'fixed' };
            if (n.sizing.vertical === 'fill') props.sizing = { ...(props.sizing ?? n.sizing), vertical: 'fixed' };
          }
          ops.push(op.update(it.id, props));
        }
        const res = dispatch(ops, { label: 'Move into', mergeKey: g.key, mergeWindow: Infinity });
        if (!res.ok) s.showToast(res.error, 'error');
      } else if (!g.flowId) {
        const fresh = getProject()!;
        const overrides: Record<string, Rect> = {};
        for (const it of g.items) {
          const n = fresh.nodes[it.id];
          if (n) overrides[it.id] = { ...it.rect, x: it.rect.x + (n.x - it.x), y: it.rect.y + (n.y - it.y) };
        }
        const ops = fitGroupOps(fresh, overrides);
        if (ops.length) dispatch(ops, { label: 'Move', mergeKey: g.key, mergeWindow: Infinity });
      }
      useDocStore.getState().sealHistory();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const project = getProject();
    const s = useEditorStore.getState();
    if (!project || s.tool !== 'select') return;
    const hitId = nodeIdAtPoint(e.clientX, e.clientY);
    if (!hitId) return;
    const path = hitPath(project, hitId);
    const idx = path.findIndex((n) => s.selection.includes(n.id));
    const cur = idx >= 0 ? path[idx]! : null;
    if (cur?.type === 'text') return s.setEditingText(cur.id);
    // Double-click on an instance selects the layer inside it (to edit its overrides).
    if (parseVirtualId(hitId) && (cur?.type === 'instance' || path[path.length - 1]?.type === 'instance')) {
      if (cur?.type === 'instance' || path[path.length - 1]!.id === parseVirtualId(hitId)!.instanceId) return s.select([hitId]);
    }
    const next = idx >= 0 ? path[idx + 1] : path[path.length - 1];
    if (next) {
      s.select([next.id]);
      if (next.type === 'text' && next.id === path[path.length - 1]!.id && idx >= 0 && idx + 1 === path.length - 1) {
        // Double-clicking a text layer directly beneath the selection enters editing.
        s.setEditingText(next.id);
      }
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const project = getProject();
    const s = useEditorStore.getState();
    if (!project) return;
    const hitId = nodeIdFromTarget(e.target);
    const path = hitId ? hitPath(project, hitId) : [];
    const target = pickTarget(project, path, s.selection, e.metaKey || e.ctrlKey);
    if (target && !s.selection.includes(target)) s.select([target]);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    const project = getProject();
    const s = useEditorStore.getState();
    if (!files.length || !project || !s.pageId) return;
    const world = toWorld(e.clientX, e.clientY);
    const parentId = containerAt(project, s.pageId, { x: e.clientX, y: e.clientY }, new Set());
    void importAndInsertImages(files, world, parentId);
  };

  const cursor = panning ? 'grabbing' : spaceDown || tool === 'hand' ? 'grab' : DRAW_TOOLS.includes(tool) ? (tool === 'text' ? 'text' : 'crosshair') : 'default';

  return (
    <div
      ref={rootRef}
      data-canvas-root
      className="relative h-full w-full overflow-hidden select-none outline-none"
      style={{ background: page?.background ?? '#1E1F25', cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => !gestureRef.current && useEditorStore.getState().setHovered(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
    >
      <div
        ref={worldRef}
        data-canvas-world
        className="absolute left-0 top-0"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0', width: 0, height: 0 }}
      >
        {page?.childIds.map((id) => <NodeView key={id} id={id} chain={chain} />)}
      </div>
      <Overlay onHandleDown={onHandleDown} onFrameLabelDown={onFrameLabelDown} onGuideDown={onGuideDown} onLinkHandleDown={onLinkHandleDown} />
      <LinkPrompt />
      {showRulers && <Rulers onRulerDown={onRulerDown} />}
      <BreakpointBar />
      {dropActive && (
        <div className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border-2 border-dashed border-accent/70 bg-accent/5 text-sm text-fg">
          {t('canvas.dropImage')}
        </div>
      )}
      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function createDrawnNode(tool: Tool, parentId: string, r: Rect, project: Project): DesignNode {
  const parent = project.nodes[parentId];
  const flow = parent?.type === 'frame' && parent.layout.mode !== 'none';
  const box = { parentId, x: r.x, y: r.y, width: Math.max(1, r.width), height: Math.max(1, r.height) };
  let node: DesignNode;
  switch (tool) {
    case 'frame': {
      const n = Object.values(project.nodes).filter((x) => x.type === 'frame').length + 1;
      node = createFrame({ ...box, name: `Frame ${n}` });
      break;
    }
    case 'ellipse':
      node = createEllipse(box);
      break;
    case 'line':
      node = createLine({ ...box, height: r.height });
      break;
    case 'text':
      node = createText(box, { characters: '', sizing: { horizontal: 'fixed', vertical: 'hug' } });
      node.name = 'Testo';
      break;
    default:
      node = createRect(box);
  }
  node.layoutPositioning = flow ? 'auto' : 'absolute';
  return node;
}
