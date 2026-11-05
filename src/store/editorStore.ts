/** Editor UI state — never persisted inside the document. */
import { create } from 'zustand';
import type { SnapLine, Rect } from '@/core/geometry';
import type { Project } from '@/core/schema';

export type Tool = 'select' | 'hand' | 'frame' | 'rect' | 'ellipse' | 'line' | 'text' | 'image';
export type LeftTab = 'layers' | 'insert' | 'assets';
export type EditorMode = 'design' | 'workflow';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

interface EditorState {
  mode: EditorMode;
  setMode: (mode: EditorMode) => void;
  pageId: string | null;
  selection: string[];
  hoveredId: string | null;
  tool: Tool;
  viewports: Record<string, Viewport>;
  editingTextId: string | null;
  leftTab: LeftTab;
  showRulers: boolean;
  snapping: boolean;
  snapLines: SnapLine[];
  marquee: Rect | null;
  /** Measured world-space rects of rendered nodes (from the DOM). */
  rects: Record<string, Rect>;
  toast: { id: number; message: string; tone: 'info' | 'error' } | null;

  reset: (pageId: string) => void;
  setPage: (pageId: string) => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setHovered: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  setViewport: (vp: Viewport) => void;
  setEditingText: (id: string | null) => void;
  setLeftTab: (tab: LeftTab) => void;
  toggleRulers: () => void;
  toggleSnapping: () => void;
  setSnapLines: (lines: SnapLine[]) => void;
  setMarquee: (r: Rect | null) => void;
  setRects: (rects: Record<string, Rect>) => void;
  showToast: (message: string, tone?: 'info' | 'error') => void;
  restoreSelection: (ids: string[], project: Project) => void;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 80, zoom: 0.5 };

export const useEditorStore = create<EditorState>()((set, get) => ({
  mode: 'design',
  setMode: (mode) => set({ mode, hoveredId: null, editingTextId: null, snapLines: [], marquee: null }),
  pageId: null,
  selection: [],
  hoveredId: null,
  tool: 'select',
  viewports: {},
  editingTextId: null,
  leftTab: 'layers',
  showRulers: true,
  snapping: true,
  snapLines: [],
  marquee: null,
  rects: {},
  toast: null,

  reset: (pageId) =>
    set({ mode: 'design', pageId, selection: [], hoveredId: null, tool: 'select', editingTextId: null, snapLines: [], marquee: null, rects: {} }),
  setPage: (pageId) => set({ pageId, selection: [], hoveredId: null, editingTextId: null }),
  select: (ids) => {
    const cur = get().selection;
    if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return;
    set({ selection: ids });
  },
  toggleSelect: (id) => {
    const cur = get().selection;
    set({ selection: cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id] });
  },
  setHovered: (id) => get().hoveredId !== id && set({ hoveredId: id }),
  setTool: (tool) => set({ tool, editingTextId: null }),
  setViewport: (vp) => {
    const pageId = get().pageId;
    if (!pageId) return;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom));
    set((s) => ({ viewports: { ...s.viewports, [pageId]: { ...vp, zoom } } }));
  },
  setEditingText: (id) => set({ editingTextId: id }),
  setLeftTab: (leftTab) => set({ leftTab }),
  toggleRulers: () => set((s) => ({ showRulers: !s.showRulers })),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
  setSnapLines: (snapLines) => (snapLines.length || get().snapLines.length ? set({ snapLines }) : undefined),
  setMarquee: (marquee) => set({ marquee }),
  setRects: (rects) => set({ rects }),
  showToast: (message, tone = 'info') => set({ toast: { id: Date.now(), message, tone } }),
  restoreSelection: (ids, project) => {
    const valid = ids.filter((id) => project.nodes[id]);
    // Follow the selection to its page if needed.
    const first = valid[0] ? project.nodes[valid[0]] : undefined;
    if (first) {
      let cur = first;
      while (project.nodes[cur.parentId]) cur = project.nodes[cur.parentId]!;
      if (cur.parentId !== get().pageId) set({ pageId: cur.parentId });
    }
    if (get().pageId && !project.pages.some((p) => p.id === get().pageId)) set({ pageId: project.pages[0]!.id });
    set({ selection: valid, editingTextId: null });
  },
}));

export function useViewport(): Viewport {
  return useEditorStore((s) => (s.pageId ? s.viewports[s.pageId] : undefined) ?? DEFAULT_VIEWPORT);
}

export function getViewport(): Viewport {
  const s = useEditorStore.getState();
  return (s.pageId ? s.viewports[s.pageId] : undefined) ?? DEFAULT_VIEWPORT;
}
