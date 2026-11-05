import { useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { unionRects, type Rect } from '@/core/geometry';
import { useEditorStore, useViewport } from '@/store/editorStore';

export const RULER_SIZE = 20;

const STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

function readVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function drawRuler(canvas: HTMLCanvasElement, axis: 'x' | 'y', offset: number, zoom: number, highlight: [number, number] | null) {
  const dpr = window.devicePixelRatio || 1;
  const length = axis === 'x' ? canvas.clientWidth : canvas.clientHeight;
  const w = axis === 'x' ? length : RULER_SIZE;
  const h = axis === 'x' ? RULER_SIZE : length;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = readVar('--color-panel', '#15161B');
  ctx.fillRect(0, 0, w, h);
  if (highlight) {
    ctx.fillStyle = 'rgba(139, 123, 255, 0.18)';
    const a = highlight[0] * zoom + offset;
    const b = highlight[1] * zoom + offset;
    if (axis === 'x') ctx.fillRect(a, 0, b - a, h);
    else ctx.fillRect(0, a, w, b - a);
  }
  const step = STEPS.find((s) => s * zoom >= 60) ?? 10000;
  const minor = step / 5;
  const start = Math.floor(-offset / zoom / minor) * minor;
  const end = (length - offset) / zoom;
  ctx.strokeStyle = readVar('--color-line-strong', '#34363F');
  ctx.fillStyle = readVar('--color-fg-subtle', '#6B6E7B');
  ctx.font = '9px "Inter Variable", system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = start; v <= end; v += minor) {
    const p = Math.round(v * zoom + offset) + 0.5;
    const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
    const len = major ? RULER_SIZE : 4;
    if (axis === 'x') {
      ctx.moveTo(p, RULER_SIZE);
      ctx.lineTo(p, RULER_SIZE - len);
      if (major) ctx.fillText(String(Math.round(v)), p + 3, 9);
    } else {
      ctx.moveTo(RULER_SIZE, p);
      ctx.lineTo(RULER_SIZE - len, p);
      if (major) {
        ctx.save();
        ctx.translate(9, p - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(v)), 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
  ctx.strokeStyle = readVar('--color-line', '#24262D');
  ctx.beginPath();
  if (axis === 'x') {
    ctx.moveTo(0, RULER_SIZE - 0.5);
    ctx.lineTo(w, RULER_SIZE - 0.5);
  } else {
    ctx.moveTo(RULER_SIZE - 0.5, 0);
    ctx.lineTo(RULER_SIZE - 0.5, h);
  }
  ctx.stroke();
}

export function Rulers({ onRulerDown }: { onRulerDown: (e: RPointerEvent, axis: 'x' | 'y') => void }) {
  const vp = useViewport();
  const rects = useEditorStore((s) => s.rects);
  const selection = useEditorStore((s) => s.selection);
  const hRef = useRef<HTMLCanvasElement>(null);
  const vRef = useRef<HTMLCanvasElement>(null);
  const bounds = unionRects(selection.map((id) => rects[id]).filter(Boolean) as Rect[]);

  useEffect(() => {
    const draw = () => {
      if (hRef.current) drawRuler(hRef.current, 'x', vp.x, vp.zoom, bounds ? [bounds.x, bounds.x + bounds.width] : null);
      if (vRef.current) drawRuler(vRef.current, 'y', vp.y, vp.zoom, bounds ? [bounds.y, bounds.y + bounds.height] : null);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [vp.x, vp.y, vp.zoom, bounds?.x, bounds?.y, bounds?.width, bounds?.height]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {/* Horizontal ruler creates vertical guides (x axis) and vice versa. */}
      <canvas
        ref={hRef}
        className="absolute left-0 top-0 h-5 w-full cursor-ns-resize"
        onPointerDown={(e) => {
          e.stopPropagation();
          onRulerDown(e, 'y');
        }}
      />
      <canvas
        ref={vRef}
        className="absolute left-0 top-0 h-full w-5 cursor-ew-resize"
        onPointerDown={(e) => {
          e.stopPropagation();
          onRulerDown(e, 'x');
        }}
      />
      <div className="pointer-events-none absolute left-0 top-0 h-5 w-5 border-b border-r border-line bg-panel" />
    </>
  );
}
