import { unionRects, type Rect } from '@/core/geometry';
import { getProject } from '@/store/docStore';
import { getViewport, MAX_ZOOM, MIN_ZOOM, useEditorStore } from '@/store/editorStore';

function canvasSize() {
  const el = document.querySelector('[data-canvas-root]');
  return { w: el?.clientWidth ?? 1200, h: el?.clientHeight ?? 800 };
}

export function zoomBy(factor: number) {
  const v = getViewport();
  const { w, h } = canvasSize();
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
  const k = zoom / v.zoom;
  useEditorStore.getState().setViewport({ zoom, x: w / 2 - (w / 2 - v.x) * k, y: h / 2 - (h / 2 - v.y) * k });
}

export function setZoom(zoom: number) {
  zoomBy(zoom / getViewport().zoom);
}

export function zoomTo100() {
  setZoom(1);
}

export function zoomToRect(r: Rect, maxZoom = 1, padding = 80) {
  const { w, h } = canvasSize();
  const zoom = Math.min(maxZoom, Math.max(MIN_ZOOM, Math.min((w - padding * 2) / Math.max(r.width, 1), (h - padding * 2) / Math.max(r.height, 1))));
  useEditorStore.getState().setViewport({ zoom, x: w / 2 - (r.x + r.width / 2) * zoom, y: h / 2 - (r.y + r.height / 2) * zoom });
}

export function zoomToFit() {
  const s = useEditorStore.getState();
  const project = getProject();
  const page = project?.pages.find((p) => p.id === s.pageId);
  if (!page) return;
  const r = unionRects(page.childIds.map((id) => s.rects[id]).filter(Boolean) as Rect[]);
  if (r) zoomToRect(r, 1);
  else useEditorStore.getState().setViewport({ x: 80, y: 80, zoom: 1 });
}

export function zoomToSelection() {
  const s = useEditorStore.getState();
  const r = unionRects(s.selection.map((id) => s.rects[id]).filter(Boolean) as Rect[]);
  if (r) zoomToRect(r, 4);
  else zoomToFit();
}
