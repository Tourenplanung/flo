import { useT } from '@/i18n';
import { createFrame, FRAME_PRESETS } from '@/core/factory';
import type { FrameNode, IconNode, ImageNode, InstanceNode, LineNode, TextNode } from '@/core/schema';
import { insertTree } from '@/editor/actions';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { ColorField, Section } from '@/ui/common/controls';
import { EffectsSection, FillSection, LayerSection, StrokeSection } from './AppearanceSections';
import { IconSection, ImageSection, LineSection, TypographySection } from './ContentSections';
import { useSelectedNodes } from './helpers';
import { AlignRow, AutoLayoutSection, GeometrySection } from './LayoutSection';
import { BreakpointBanner, ComponentSection, ConstraintsSection, InstanceLayerInspector, InstanceSection } from './SystemSections';
import { isVirtualId } from '@/core/instance';
import { PrototypeSection } from './PrototypeSection';
import { zoomToRect } from '../viewportActions';

/** Places a new top-level frame to the right of existing content on the page. */
export function addFramePreset(width: number, height: number, name: string) {
  const project = getProject();
  const s = useEditorStore.getState();
  if (!project || !s.pageId) return;
  const page = project.pages.find((p) => p.id === s.pageId)!;
  let x = 0;
  for (const id of page.childIds) {
    const r = s.rects[id];
    const n = project.nodes[id];
    const right = r ? r.x + r.width : n ? n.x + n.width : 0;
    x = Math.max(x, right + 100);
  }
  const frame = createFrame({ parentId: page.id, x, y: 0, width, height, name });
  if (insertTree({ root: frame, nodes: [frame] }, page.id, { x, y: 0 }, 'Add frame')) {
    zoomToRect({ x, y: 0, width, height }, 1);
  }
}

export function FramePresets() {
  const t = useT();
  return (
    <Section title={t('insp.framePresets')}>
      <div className="flex flex-col">
        {FRAME_PRESETS.map((p) => (
          <button
            key={p.id}
            data-testid={`preset-${p.id}`}
            className="flex h-7 items-center justify-between rounded px-2 text-left text-[11px] text-fg hover:bg-field-hover"
            onClick={() => addFramePreset(p.width, p.height, p.name)}
          >
            <span>{p.name}</span>
            <span className="tabular-nums text-fg-subtle">
              {p.width} × {p.height}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function PageSection() {
  const t = useT();
  const pageId = useEditorStore((s) => s.pageId);
  const page = useDocStore((s) => s.project?.pages.find((p) => p.id === pageId));
  if (!page) return null;
  return (
    <Section title={t('insp.page')}>
      <div className="flex items-center gap-2">
        <span className="w-16 text-[11px] text-fg-muted">{t('insp.background')}</span>
        <ColorField
          color={page.background}
          onChange={(background) => dispatch([{ type: 'updatePage', id: page.id, props: { background } }], { label: 'Page background', mergeKey: 'pagebg' })}
        />
      </div>
    </Section>
  );
}

export function Inspector() {
  const t = useT();
  const nodes = useSelectedNodes();
  const tool = useEditorStore((s) => s.tool);

  if (!nodes.length) {
    return (
      <div data-testid="inspector">
        {tool === 'frame' && <FramePresets />}
        <PageSection />
        <p className="px-3 py-4 text-[11px] leading-4 text-fg-subtle">{t('insp.empty')}</p>
      </div>
    );
  }

  if (nodes.some((n) => isVirtualId(n.id))) {
    return nodes.length === 1 ? (
      <div data-testid="inspector">
        <InstanceLayerInspector node={nodes[0]!} />
      </div>
    ) : (
      <div data-testid="inspector" className="px-3 py-4 text-[11px] text-fg-subtle">
        {t('insp.multiple', { n: nodes.length })}
      </div>
    );
  }

  const frames = nodes.filter((n): n is FrameNode => n.type === 'frame');
  const instances = nodes.filter((n): n is InstanceNode => n.type === 'instance');
  const texts = nodes.filter((n): n is TextNode => n.type === 'text');
  const images = nodes.filter((n): n is ImageNode => n.type === 'image');
  const icons = nodes.filter((n): n is IconNode => n.type === 'icon');
  const lines = nodes.filter((n): n is LineNode => n.type === 'line');
  const all = <T,>(list: T[]) => list.length === nodes.length;
  const isGroupOnly = nodes.every((n) => n.type === 'group' || n.type === 'instance');

  return (
    <div data-testid="inspector">
      {tool === 'frame' && <FramePresets />}
      <div className="flex h-9 items-center border-b border-line px-3 text-[11px] font-semibold text-fg">
        {nodes.length === 1 ? (
          <span className="truncate">
            <span className="mr-1.5 uppercase tracking-wide text-fg-subtle">{nodes[0]!.type}</span>
            {nodes[0]!.name}
          </span>
        ) : (
          t('insp.multiple', { n: nodes.length })
        )}
      </div>
      <BreakpointBanner ids={nodes.map((n) => n.id)} />
      <AlignRow nodes={nodes} />
      <GeometrySection nodes={nodes} />
      <ConstraintsSection nodes={nodes} />
      {instances.length === 1 && nodes.length === 1 && <InstanceSection node={instances[0]!} />}
      {frames.length === 1 && nodes.length === 1 && <ComponentSection frame={frames[0]!} />}
      {all(frames) && <AutoLayoutSection frames={frames} />}
      {!isGroupOnly && <LayerSection nodes={nodes} />}
      {all(texts) && <TypographySection nodes={texts} />}
      {all(images) && <ImageSection nodes={images} />}
      {all(icons) && <IconSection nodes={icons} />}
      {all(lines) && <LineSection nodes={lines} />}
      {!isGroupOnly && !all(lines) && <FillSection nodes={nodes} />}
      {!isGroupOnly && !texts.length && !icons.length && <StrokeSection nodes={nodes} />}
      {!isGroupOnly && <EffectsSection nodes={nodes} />}
      {nodes.length === 1 && <PrototypeSection node={nodes[0]!} />}
    </div>
  );
}
