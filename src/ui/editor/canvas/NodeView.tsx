import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { ImageIcon } from 'lucide-react';
import { nodeStyle } from '@/core/style';
import type { DesignNode, ImageNode, LineNode, TextNode } from '@/core/schema';
import { useAssetUrl } from '@/editor/assetUrls';
import { expandInstance } from '@/core/instance';
import { resolveNode } from '@/core/resolve';
import { effectiveNode } from '@/editor/effective';
import { getProject, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { DESIGN_ICONS } from '@/ui/common/icons';
import { commitTextEdit } from './textEditing';

export const NodeView = memo(function NodeView({ id, chain }: { id: string; chain: string[] }) {
  const raw = useDocStore((s) => s.project?.nodes[id]);
  const rawParent = useDocStore((s) => (raw ? s.project?.nodes[raw.parentId] ?? null : null));
  // Re-render when tokens or breakpoints change (resolution inputs).
  useDocStore((s) => s.project?.tokens);
  const editing = useEditorStore((s) => s.editingTextId === id);
  const project = getProject();
  if (!raw || !project) return null;
  const node = effectiveNode(project, id, chain)!;
  const parent = rawParent ? effectiveNode(project, rawParent.id, chain) ?? null : null;
  if (raw.type === 'instance') return <InstanceView instanceId={id} chain={chain} parent={parent} />;
  const style = nodeStyle(node, { parent }) as CSSProperties;
  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      data-name={node.name}
      data-component={node.type === 'frame' && node.component ? 'main' : undefined}
      data-locked={node.locked || undefined}
      style={style}
    >
      <NodeContent node={node} editing={editing} />
      {node.childIds.map((c) => (
        <NodeView key={c} id={c} chain={chain} />
      ))}
    </div>
  );
});

/** Renders an instance by expanding its main component (re-renders when the document changes). */
function InstanceView({ instanceId, chain, parent }: { instanceId: string; chain: string[]; parent: DesignNode | null }) {
  const nodes = useDocStore((s) => s.project?.nodes);
  const tokens = useDocStore((s) => s.project?.tokens);
  const project = getProject();
  const exp = useMemo(() => {
    const inst = project?.nodes[instanceId];
    return project && inst?.type === 'instance' ? expandInstance(project, inst) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, tokens, instanceId]);
  const inst = project?.nodes[instanceId];
  if (!project || !inst) return null;
  if (!exp) {
    // Main component missing: show a clear placeholder instead of failing.
    return (
      <div data-node-id={instanceId} data-node-type="instance" data-name={inst.name} style={{ ...(nodeStyle(inst, { parent }) as CSSProperties), outline: '1px dashed #ff5f6d' }} />
    );
  }
  return <VirtualView node={exp.root} nodes={exp.nodes} parent={parent} chain={chain} instance />;
}

function VirtualView({ node: rawNode, nodes, parent, chain, instance }: { node: DesignNode; nodes: Record<string, DesignNode>; parent: DesignNode | null; chain: string[]; instance?: boolean }) {
  const project = getProject()!;
  const node = resolveNode(rawNode, project.tokens, chain);
  if (node.type === 'instance') {
    const exp = expandInstance(project, node);
    if (exp) {
      // Nested instance: re-key its virtual layers under this virtual id.
      return <VirtualView node={{ ...exp.root, id: node.id, parentId: node.parentId }} nodes={exp.nodes} parent={parent} chain={chain} instance />;
    }
  }
  const style = nodeStyle(node, { parent }) as CSSProperties;
  return (
    <div data-node-id={node.id} data-node-type={instance ? 'instance' : node.type} data-name={node.name} data-virtual={instance ? undefined : ''} style={style}>
      <NodeContent node={node} editing={false} />
      {node.childIds.map((c) => {
        const child = nodes[c];
        return child ? <VirtualView key={c} node={child} nodes={nodes} parent={node} chain={chain} /> : null;
      })}
    </div>
  );
}

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
