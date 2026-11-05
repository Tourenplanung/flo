import {
  ChevronRight,
  Circle,
  Eye,
  EyeOff,
  Frame,
  Group,
  Image as ImageIcon,
  LayoutList,
  Lock,
  Minus,
  Square,
  Star,
  Type,
  Unlock,
  Columns3,
  Component,
  Diamond,
} from 'lucide-react';
import { memo, useEffect, useRef, useState, type DragEvent } from 'react';
import { op, type DocOp } from '@/core/ops';

type MoveOp = Extract<DocOp, { type: 'moveNode' }>;
import { isContainer, type DesignNode, type Project } from '@/core/schema';
import { getChildIds, isAncestor, sortByDocumentOrder, topLevelOnly } from '@/core/tree';
import { parentOrigin, toggleLock, toggleVisibility, worldRect } from '@/editor/actions';
import { useT } from '@/i18n';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { cx } from '@/ui/common/controls';

const DRAG_MIME = 'application/x-flo-layers';

type DropPos = 'before' | 'after' | 'inside';

function NodeIcon({ node }: { node: DesignNode }) {
  const size = 13;
  switch (node.type) {
    case 'instance':
      return <Diamond size={size} className="text-accent" />;
    case 'frame':
      if (node.component) return <Component size={size} className="text-accent" />;
      if (node.layout.mode === 'vertical') return <LayoutList size={size} />;
      if (node.layout.mode === 'horizontal') return <Columns3 size={size} />;
      return <Frame size={size} />;
    case 'group':
      return <Group size={size} />;
    case 'text':
      return <Type size={size} />;
    case 'ellipse':
      return <Circle size={size} />;
    case 'line':
      return <Minus size={size} />;
    case 'image':
      return <ImageIcon size={size} />;
    case 'icon':
      return <Star size={size} />;
    default:
      return <Square size={size} />;
  }
}

/** Builds move ops for dropping `ids` relative to `targetId`. Layers list shows front-most first. */
function dropOps(project: Project, ids: string[], targetId: string, pos: DropPos): MoveOp[] | null {
  const target = project.nodes[targetId];
  if (!target) return null;
  if (ids.includes(targetId) || ids.some((id) => isAncestor(project, id, targetId))) return null;
  const parentId = pos === 'inside' ? targetId : target.parentId;
  const sim = structuredClone(project) as Project;
  const ops: MoveOp[] = [];
  const ordered = sortByDocumentOrder(project, ids);
  for (const id of ordered) {
    const n = sim.nodes[id]!;
    getChildIds(sim, n.parentId).splice(getChildIds(sim, n.parentId).indexOf(id), 1);
    const list = getChildIds(sim, parentId);
    let index: number;
    if (pos === 'inside') index = list.length;
    else {
      const ti = list.indexOf(targetId);
      // "before" in the visual list (above) means later in document order (in front).
      index = pos === 'before' ? ti + 1 : ti;
      if (ops.length) index = list.indexOf(ops[ops.length - 1]!.id) + 1;
    }
    list.splice(index, 0, id);
    n.parentId = parentId;
    ops.push({ type: 'moveNode', id, parentId, index });
  }
  return ops;
}

const LayerRow = memo(function LayerRow({ id, depth }: { id: string; depth: number }) {
  const t = useT();
  const node = useDocStore((s) => s.project?.nodes[id]);
  const selected = useEditorStore((s) => s.selection.includes(id));
  const hovered = useEditorStore((s) => s.hoveredId === id);
  const ancestorSelected = useEditorStore((s) => {
    const p = getProject();
    return !!p && s.selection.some((sid) => sid !== id && isAncestor(p, sid, id));
  });
  const [open, setOpen] = useState(depth === 0);
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<DropPos | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Auto-expand when a descendant gets selected.
  const descendantSelected = useEditorStore((s) => {
    const p = getProject();
    return !!p && s.selection.some((sid) => isAncestor(p, id, sid));
  });
  useEffect(() => {
    if (descendantSelected) setOpen(true);
  }, [descendantSelected]);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!node) return null;
  const container = isContainer(node);
  const hasChildren = node.childIds.length > 0;

  const onClick = (e: React.MouseEvent) => {
    const s = useEditorStore.getState();
    if (e.shiftKey || e.metaKey || e.ctrlKey) s.toggleSelect(id);
    else s.select([id]);
  };

  const onDragStart = (e: DragEvent) => {
    const s = useEditorStore.getState();
    const project = getProject()!;
    const ids = s.selection.includes(id) ? topLevelOnly(project, s.selection) : [id];
    if (!s.selection.includes(id)) s.select([id]);
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };

  const computePos = (e: DragEvent): DropPos => {
    const r = rowRef.current!.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (container && y > 0.25 && y < 0.75) return 'inside';
    return y < 0.5 ? 'before' : 'after';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrop(null);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    let ids: string[];
    try {
      ids = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string');
    } catch {
      return;
    }
    const project = getProject()!;
    const pos = computePos(e);
    const ops = dropOps(project, ids, id, pos);
    if (!ops) return;
    // Preserve on-canvas positions of absolutely positioned layers across parents.
    const parentId = ops[0]!.parentId;
    const parent = project.nodes[parentId];
    const flow = parent?.type === 'frame' && parent.layout.mode !== 'none';
    const o = parentOrigin(project, parentId);
    const updates = ids
      .filter((nid) => project.nodes[nid]!.parentId !== parentId)
      .map((nid) => {
        const r = worldRect(project, nid);
        return op.update(nid, flow ? { layoutPositioning: 'auto' } : { layoutPositioning: 'absolute', ...(r ? { x: Math.round(r.x - o.x), y: Math.round(r.y - o.y) } : {}) });
      });
    const res = dispatch([...ops, ...updates], { label: 'Reorder layers' });
    if (!res.ok) useEditorStore.getState().showToast(res.error, 'error');
  };

  return (
    <li>
      <div
        ref={rowRef}
        data-layer-id={id}
        draggable={!renaming}
        onDragStart={onDragStart}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
          e.preventDefault();
          setDrop(computePos(e));
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
        onClick={onClick}
        onDoubleClick={() => setRenaming(true)}
        onPointerEnter={() => useEditorStore.getState().setHovered(id)}
        onPointerLeave={() => useEditorStore.getState().setHovered(null)}
        className={cx(
          'group relative flex h-7 items-center gap-1 pr-1.5 text-[11px]',
          selected ? 'bg-accent/25 text-fg' : ancestorSelected ? 'bg-accent/8 text-fg' : 'text-fg-muted hover:text-fg',
          hovered && !selected && 'outline outline-1 -outline-offset-1 outline-accent/60',
          !node.visible && 'opacity-50',
          drop === 'inside' && 'outline outline-2 -outline-offset-2 outline-accent',
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {drop === 'before' && <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-accent" />}
        {drop === 'after' && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
        <button
          aria-label="toggle"
          className={cx('flex h-4 w-4 items-center justify-center text-fg-subtle', !hasChildren && 'invisible')}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          <ChevronRight size={12} className={cx('transition-transform', open && 'rotate-90')} />
        </button>
        <span className={cx('shrink-0', node.type === 'frame' && depth === 0 ? 'text-fg' : 'text-fg-subtle')}>
          <NodeIcon node={node} />
        </span>
        {renaming ? (
          <input
            autoFocus
            defaultValue={node.name}
            data-testid="layer-rename"
            className="h-5 w-full min-w-0 rounded bg-bg px-1 text-[11px] text-fg outline-none ring-1 ring-accent"
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== node.name) dispatch([op.update(id, { name })], { label: 'Rename' });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className={cx('flex-1 truncate', depth === 0 && node.type === 'frame' && 'font-medium')}>{node.name || node.type}</span>
        )}
        <button
          title={node.locked ? t('left.unlock') : t('left.lock')}
          aria-label={node.locked ? t('left.unlock') : t('left.lock')}
          className={cx('shrink-0 text-fg-subtle hover:text-fg', !node.locked && 'invisible group-hover:visible')}
          onClick={(e) => {
            e.stopPropagation();
            toggleLock([id]);
          }}
        >
          {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
        <button
          title={node.visible ? t('left.hide') : t('left.show')}
          aria-label={node.visible ? t('left.hide') : t('left.show')}
          className={cx('shrink-0 text-fg-subtle hover:text-fg', node.visible && 'invisible group-hover:visible')}
          onClick={(e) => {
            e.stopPropagation();
            toggleVisibility([id]);
          }}
        >
          {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
      {open && hasChildren && (
        <ul>
          {[...node.childIds].reverse().map((c) => (
            <LayerRow key={c} id={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
});

export function LayersPanel() {
  const t = useT();
  const pageId = useEditorStore((s) => s.pageId);
  const childIds = useDocStore((s) => s.project?.pages.find((p) => p.id === pageId)?.childIds ?? []);

  const onDropRoot = (e: DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw || !pageId) return;
    e.preventDefault();
    const project = getProject()!;
    let ids: string[] = [];
    try {
      ids = (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === 'string' && !!project.nodes[x]);
    } catch {
      return;
    }
    const ops = ids.flatMap((id) => {
      const r = worldRect(project, id);
      return [op.move(id, pageId), op.update(id, { layoutPositioning: 'absolute', ...(r ? { x: Math.round(r.x), y: Math.round(r.y) } : {}) })];
    });
    dispatch(ops, { label: 'Move to page' });
  };

  if (!childIds.length) {
    return <p className="px-3 py-3 text-[11px] leading-4 text-fg-subtle">{t('left.noLayers')}</p>;
  }
  return (
    <ul
      className="min-h-full pb-10"
      data-testid="layers-list"
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
      onDrop={onDropRoot}
    >
      {[...childIds].reverse().map((id) => (
        <LayerRow key={id} id={id} depth={0} />
      ))}
    </ul>
  );
}
