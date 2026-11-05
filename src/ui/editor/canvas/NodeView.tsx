import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { ImageIcon } from 'lucide-react';
import { nodeStyle } from '@/core/style';
import type { DesignNode, ImageNode, LineNode, TextNode } from '@/core/schema';
import { useAssetUrl } from '@/editor/assetUrls';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { DESIGN_ICONS } from '@/ui/common/icons';
import { commitTextEdit } from './textEditing';

export const NodeView = memo(function NodeView({ id }: { id: string }) {
  const node = useDocStore((s) => s.project?.nodes[id]);
  const parent = useDocStore((s) => (node ? s.project?.nodes[node.parentId] ?? null : null));
  const editing = useEditorStore((s) => s.editingTextId === id);
  if (!node) return null;
  const style = nodeStyle(node, { parent }) as CSSProperties;
  return (
    <div data-node-id={node.id} data-node-type={node.type} data-name={node.name} data-locked={node.locked || undefined} style={style}>
      <NodeContent node={node} editing={editing} />
      {node.childIds.map((c) => (
        <NodeView key={c} id={c} />
      ))}
    </div>
  );
});

function NodeContent({ node, editing }: { node: DesignNode; editing: boolean }) {
  switch (node.type) {
    case 'text':
      return editing ? <TextEditor node={node} /> : <>{node.characters || '​'}</>;
    case 'image':
      return <ImageContent node={node} />;
    case 'line':
      return <LineContent node={node} />;
    case 'icon': {
      const Icon = DESIGN_ICONS[node.icon];
      return <Icon width="100%" height="100%" strokeWidth={node.strokeWidth} style={{ display: 'block', pointerEvents: 'none' }} />;
    }
    default:
      return null;
  }
}

function ImageContent({ node }: { node: ImageNode }) {
  const projectId = useDocStore((s) => s.project?.id);
  const url = useAssetUrl(projectId, node.assetId);
  if (!url) {
    return (
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{ color: 'rgba(0,0,0,0.28)', borderRadius: 'inherit', overflow: 'hidden' }}
      >
        <ImageIcon style={{ width: '24%', height: '24%', maxWidth: 64, maxHeight: 64, minWidth: 12, minHeight: 12 }} strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={node.alt}
      draggable={false}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: node.fit, borderRadius: 'inherit', pointerEvents: 'none' }}
    />
  );
}

function LineContent({ node }: { node: LineNode }) {
  const s = node.stroke;
  if (!s?.visible) return null;
  const w = Math.max(node.width, 0.01);
  const h = Math.max(node.height, 0.01);
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
    >
      <line
        x1={0}
        y1={node.flip ? node.height : 0}
        x2={node.width}
        y2={node.flip ? 0 : node.height}
        stroke={s.color}
        strokeOpacity={s.opacity}
        strokeWidth={s.width}
        strokeLinecap="round"
      />
      {/* Wide transparent hit area */}
      <line
        x1={0}
        y1={node.flip ? node.height : 0}
        x2={node.width}
        y2={node.flip ? 0 : node.height}
        stroke="transparent"
        strokeWidth={Math.max(8, s.width + 6)}
        style={{ pointerEvents: 'stroke' }}
      />
    </svg>
  );
}

function TextEditor({ node }: { node: TextNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = node.characters;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) commitTextEdit(node.id, el.innerText.replace(/\n$/, ''));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span
      ref={ref}
      data-text-editor
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      style={{ outline: 'none', display: 'inline-block', minWidth: 1, width: '100%', cursor: 'text', whiteSpace: 'inherit' }}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={() => window.dispatchEvent(new Event('flo:remeasure'))}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          useEditorStore.getState().setEditingText(null);
        }
      }}
      onBlur={() => useEditorStore.getState().setEditingText(null)}
    />
  );
}
