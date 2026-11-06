import type { PointerEvent as RPointerEvent } from 'react';
import type { HandleDir, Rect } from '@/core/geometry';
import { unionRects } from '@/core/geometry';
import type { Guide } from '@/core/schema';
import { useDocStore } from '@/store/docStore';
import { useEditorStore, useViewport } from '@/store/editorStore';
import { useT } from '@/i18n';

interface Props {
  onHandleDown: (e: RPointerEvent, dir: HandleDir) => void;
  onFrameLabelDown: (e: RPointerEvent, id: string) => void;
  onGuideDown: (e: RPointerEvent, guide: Guide) => void;
  onLinkHandleDown?: (e: RPointerEvent, sourceId: string) => void;
}

const HANDLES: { dir: HandleDir; fx: number; fy: number; cursor: string }[] = [
  { dir: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { dir: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { dir: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { dir: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { dir: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { dir: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { dir: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { dir: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

const fmt = (v: number) => String(Math.round(v * 10) / 10);

export function Overlay({ onHandleDown, onFrameLabelDown, onGuideDown, onLinkHandleDown }: Props) {
  const vp = useViewport();
  const rects = useEditorStore((s) => s.rects);
  const selection = useEditorStore((s) => s.selection);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const snapLines = useEditorStore((s) => s.snapLines);
  const marquee = useEditorStore((s) => s.marquee);
  const editing = useEditorStore((s) => s.editingTextId);
  const tool = useEditorStore((s) => s.tool);
  const pageId = useEditorStore((s) => s.pageId);
  const linkDrag = useEditorStore((s) => s.linkDrag);
  const linkPrompt = useEditorStore((s) => s.linkPrompt);
  const t = useT();
  const project = useDocStore((s) => s.project);
  const page = project?.pages.find((p) => p.id === pageId);
  if (!project || !page) return null;

  const toScreen = (r: Rect): Rect => ({ x: r.x * vp.zoom + vp.x, y: r.y * vp.zoom + vp.y, width: r.width * vp.zoom, height: r.height * vp.zoom });

  const selRects = selection.map((id) => rects[id]).filter(Boolean) as Rect[];
  const single = selection.length === 1 ? project.nodes[selection[0]!] : undefined;
  const bounds = unionRects(selRects);
  const sb = bounds ? toScreen(bounds) : null;
  const hovered = hoveredId && !selection.includes(hoveredId) ? rects[hoveredId] : undefined;
  const showHandles = !!single && !single.locked && !editing && tool === 'select' && sb;
  const small = sb ? sb.width < 28 || sb.height < 28 : false;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-overlay>
      {/* Guides */}
      {page.guides.map((g) => {
        const pos = g.axis === 'x' ? g.position * vp.zoom + vp.x : g.position * vp.zoom + vp.y;
        return (
          <div
            key={g.id}
            className="pointer-events-auto absolute"
            style={
              g.axis === 'x'
                ? { left: pos - 3, top: 0, bottom: 0, width: 7, cursor: 'ew-resize' }
                : { top: pos - 3, left: 0, right: 0, height: 7, cursor: 'ns-resize' }
            }
            onPointerDown={(e) => tool === 'select' && onGuideDown(e, g)}
          >
            <div className="absolute bg-guide" style={g.axis === 'x' ? { left: 3, top: 0, bottom: 0, width: 1 } : { top: 3, left: 0, right: 0, height: 1 }} />
          </div>
        );
      })}

      {/* Top-level frame labels */}
      {page.childIds.map((id) => {
        const n = project.nodes[id];
        const r = rects[id];
        if (!n || !r || n.type !== 'frame' || !n.visible) return null;
        const s = toScreen(r);
        const selected = selection.includes(id);
        return (
          <div
            key={id}
            data-frame-label={id}
            className={`pointer-events-auto absolute truncate text-[11px] leading-4 ${selected ? 'text-accent' : 'text-fg-muted hover:text-fg'}`}
            style={{ left: s.x, top: s.y - 18, maxWidth: Math.max(40, s.width), cursor: 'default' }}
            onPointerDown={(e) => onFrameLabelDown(e, id)}
            onPointerEnter={() => useEditorStore.getState().setHovered(id)}
          >
            {n.name}
          </div>
        );
      })}

      {/* Hover */}
      {hovered && (() => {
        const s = toScreen(hovered);
        return <div className="absolute border border-accent" style={{ left: s.x, top: s.y, width: s.width, height: s.height }} />;
      })()}

      {/* Selection */}
      {selRects.length > 1 &&
        selRects.map((r, i) => {
          const s = toScreen(r);
          return <div key={i} className="absolute border border-accent/70" style={{ left: s.x, top: s.y, width: s.width, height: s.height }} />;
        })}
      {sb && (
        <div className="absolute border-[1.5px] border-accent" style={{ left: sb.x - 0.5, top: sb.y - 0.5, width: sb.width + 1, height: sb.height + 1 }} />
      )}
      {showHandles &&
        HANDLES.filter((h) => !small || h.dir.length === 2).map((h) => (
          <div
            key={h.dir}
            data-handle={h.dir}
            className="pointer-events-auto absolute h-2 w-2 rounded-[1.5px] border-[1.5px] border-accent bg-white"
            style={{ left: sb!.x + sb!.width * h.fx - 4, top: sb!.y + sb!.height * h.fy - 4, cursor: h.cursor }}
            onPointerDown={(e) => onHandleDown(e, h.dir)}
          />
        ))}
      {sb && bounds && !editing && (
        <div
          className="absolute -translate-x-1/2 whitespace-nowrap rounded bg-accent px-1.5 py-px text-[10px] font-medium leading-4 text-white tabular-nums"
          style={{ left: sb.x + sb.width / 2, top: sb.y + sb.height + 6 }}
        >
          {fmt(bounds.width)} × {fmt(bounds.height)}
        </div>
      )}

      {/* Smart guides */}
      {snapLines.map((l, i) => {
        if (l.axis === 'x') {
          const x = l.position * vp.zoom + vp.x;
          const infinite = l.from < -1e5;
          const y1 = infinite ? 0 : l.from * vp.zoom + vp.y;
          const y2 = infinite ? 10000 : l.to * vp.zoom + vp.y;
          return <div key={i} className="absolute bg-snap" style={{ left: x - 0.5, top: y1, width: 1, height: y2 - y1 }} />;
        }
        const y = l.position * vp.zoom + vp.y;
        const infinite = l.from < -1e5;
        const x1 = infinite ? 0 : l.from * vp.zoom + vp.x;
        const x2 = infinite ? 10000 : l.to * vp.zoom + vp.x;
        return <div key={i} className="absolute bg-snap" style={{ top: y - 0.5, left: x1, height: 1, width: x2 - x1 }} />;
      })}

      {/* Prototype connections of the selection */}
      <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden data-testid="proto-connections">
        <defs>
          <marker id="flo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--color-accent)" />
          </marker>
        </defs>
        {selection.flatMap((id) => {
          const n = project.nodes[id];
          const from = rects[id];
          if (!n || !from) return [];
          return n.interactions.flatMap((it) => {
            const a = it.action;
            if (a.type !== 'navigate' && a.type !== 'open-overlay') return [];
            const to = rects[a.destinationId];
            if (!to) return [];
            const s1 = toScreen(from);
            const s2 = toScreen(to);
            const x1 = s1.x + s1.width;
            const y1 = s1.y + s1.height / 2;
            const x2 = s2.x;
            const y2 = s2.y + Math.min(40, s2.height / 2);
            const dx = Math.max(40, Math.abs(x2 - x1) / 2);
            return [
              <g key={`${id}-${it.id}`}>
                <circle cx={x1} cy={y1} r={4} fill="var(--color-accent)" />
                <path
                  d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  strokeDasharray={a.type === 'open-overlay' ? '5 4' : undefined}
                  markerEnd="url(#flo-arrow)"
                />
              </g>,
            ];
          });
        })}
      </svg>

      {/* Prototype link handle: drag onto another screen, then describe the link with a prompt */}
      {single && sb && !editing && tool === 'select' && !linkDrag && onLinkHandleDown && (
        <button
          type="button"
          data-testid="proto-link-handle"
          title={t('pp.handle')}
          aria-label={t('pp.handle')}
          className="pointer-events-auto absolute flex h-4 w-4 items-center justify-center rounded-full border-2 border-accent bg-panel text-accent shadow hover:scale-125"
          style={{ left: sb.x + sb.width + 12, top: sb.y + sb.height / 2 - 8, cursor: 'crosshair' }}
          onPointerDown={(e) => onLinkHandleDown(e, single.id)}
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-accent" />
        </button>
      )}
      {(linkDrag || linkPrompt) &&
        (() => {
          const sourceId = linkDrag?.sourceId ?? linkPrompt!.sourceId;
          const from = rects[sourceId];
          const targetId = linkDrag ? linkDrag.targetId : linkPrompt!.destinationId;
          const target = targetId ? rects[targetId] : undefined;
          if (!from) return null;
          const s1 = toScreen(from);
          const x1 = s1.x + s1.width;
          const y1 = s1.y + s1.height / 2;
          let x2: number;
          let y2: number;
          if (target) {
            const s2 = toScreen(target);
            x2 = s2.x;
            y2 = s2.y + Math.min(40, s2.height / 2);
          } else {
            x2 = linkDrag!.to.x * vp.zoom + vp.x;
            y2 = linkDrag!.to.y * vp.zoom + vp.y;
          }
          const dx = Math.max(40, Math.abs(x2 - x1) / 2);
          const ts = target ? toScreen(target) : null;
          return (
            <>
              {ts && <div data-testid="proto-link-target" className="absolute rounded-sm border-2 border-accent bg-accent/10" style={{ left: ts.x, top: ts.y, width: ts.width, height: ts.height }} />}
              <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                <circle cx={x1} cy={y1} r={4} fill="var(--color-accent)" />
                <path d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#flo-arrow)" />
              </svg>
            </>
          );
        })()}

      {/* Marquee */}
      {marquee && (() => {
        const s = toScreen(marquee);
        return <div className="absolute border border-accent bg-accent/10" style={{ left: s.x, top: s.y, width: s.width, height: s.height }} />;
      })()}
    </div>
  );
}
