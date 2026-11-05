import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowRight,
  Ban,
  Columns3,
} from 'lucide-react';
import { alignSelection, parentOrigin, setSize, updateNodes, worldRect } from '@/editor/actions';
import { useT } from '@/i18n';
import type { AutoLayout, DesignNode, FrameNode, FrameRole, SizingMode } from '@/core/schema';
import { isInFlow } from '@/core/tree';
import { getProject, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { Checkbox, IconButton, MIXED, NumberField, Section, Segmented, SelectField } from '@/ui/common/controls';
import { common } from './helpers';
import { TokenPicker } from './SystemSections';

export function AlignRow({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const project = useDocStore((s) => s.project);
  const disabled = !project || nodes.every((n) => isInFlow(project, n)) || (nodes.length === 1 && !project.nodes[nodes[0]!.parentId]);
  const btn = (mode: Parameters<typeof alignSelection>[0], Icon: typeof AlignStartVertical, label: string) => (
    <IconButton key={mode} label={label} disabled={disabled} onClick={() => alignSelection(mode)} testId={`align-${mode}`}>
      <Icon size={15} />
    </IconButton>
  );
  return (
    <div className="flex items-center justify-between border-b border-line px-2 py-1.5" aria-label={t('insp.align')}>
      {btn('left', AlignStartVertical, 'Allinea a sinistra / Align left')}
      {btn('hcenter', AlignCenterVertical, 'Centra orizzontalmente / Align horizontal centers')}
      {btn('right', AlignEndVertical, 'Allinea a destra / Align right')}
      {btn('top', AlignStartHorizontal, 'Allinea in alto / Align top')}
      {btn('vcenter', AlignCenterHorizontal, 'Centra verticalmente / Align vertical centers')}
      {btn('bottom', AlignEndHorizontal, 'Allinea in basso / Align bottom')}
    </div>
  );
}

export function GeometrySection({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const ids = nodes.map((n) => n.id);
  const allFlow = nodes.every((n) => isInFlow(project, n));
  const parentFlow = nodes.every((n) => {
    const p = project.nodes[n.parentId];
    return p?.type === 'frame' && p.layout.mode !== 'none';
  });
  const canHug = (n: DesignNode) => n.type === 'text' || (n.type === 'frame' && n.layout.mode !== 'none');
  const sizingOptions = (axis: 'horizontal' | 'vertical') => {
    const prefix = axis === 'horizontal' ? '↔' : '↕';
    const opts: { value: SizingMode; label: string }[] = [{ value: 'fixed', label: `${prefix} ${t('insp.fixed')}` }];
    if (nodes.every(canHug)) opts.push({ value: 'hug', label: `${prefix} ${t('insp.hug')}` });
    if (nodes.every((n) => isInFlow(project, n))) opts.push({ value: 'fill', label: `${prefix} ${t('insp.fill')}` });
    return opts;
  };
  const mixed = t('insp.mixed');
  // Display measured geometry for content-driven sizes (hug/fill) and flow positions.
  const rects = useEditorStore((st) => st.rects);
  const measured = (n: DesignNode, key: 'x' | 'y' | 'width' | 'height'): number => {
    const r = rects[n.id];
    const round = (v: number) => Math.round(v * 100) / 100;
    if (!r) return n[key];
    if (key === 'width') return n.sizing.horizontal === 'fixed' ? n.width : round(r.width);
    if (key === 'height') return n.sizing.vertical === 'fixed' ? n.height : round(r.height);
    if (!isInFlow(project, n)) return n[key];
    const o = parentOrigin(project, n.parentId);
    return round(key === 'x' ? r.x - o.x : r.y - o.y);
  };

  return (
    <Section title={t('insp.position')}>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" mixedLabel={mixed} testId="insp-x" disabled={allFlow} value={common(nodes, (n) => measured(n, 'x'))} onChange={(v) => updateNodes(ids, { x: v }, 'x')} />
        <NumberField label="Y" mixedLabel={mixed} testId="insp-y" disabled={allFlow} value={common(nodes, (n) => measured(n, 'y'))} onChange={(v) => updateNodes(ids, { y: v }, 'y')} />
        <NumberField
          label="W"
          mixedLabel={mixed}
          testId="insp-w"
          min={0}
          value={common(nodes, (n) => measured(n, 'width'))}
          onChange={(v) => setSize(ids, { width: v }, 'w')}
        />
        <NumberField
          label="H"
          mixedLabel={mixed}
          testId="insp-h"
          min={0}
          value={common(nodes, (n) => measured(n, 'height'))}
          onChange={(v) => setSize(ids, { height: v }, 'h')}
        />
      </div>
      {allFlow && <p className="text-[10.5px] leading-4 text-fg-subtle">{t('insp.inFlow')}</p>}
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          title={`${t('insp.sizing')} W`}
          testId="insp-sizing-h"
          value={common(nodes, (n) => n.sizing.horizontal)}
          options={sizingOptions('horizontal')}
          onChange={(v) => updateNodes(ids, (n) => ({ sizing: { ...n.sizing, horizontal: v } }))}
        />
        <SelectField
          title={`${t('insp.sizing')} H`}
          testId="insp-sizing-v"
          value={common(nodes, (n) => n.sizing.vertical)}
          options={sizingOptions('vertical')}
          onChange={(v) => updateNodes(ids, (n) => ({ sizing: { ...n.sizing, vertical: v } }))}
        />
      </div>
      <details className="group">
        <summary className="cursor-default list-none text-[11px] text-fg-muted hover:text-fg">▸ {t('insp.constraints')}</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const).map((k) => (
            <NumberField
              key={k}
              label={k.startsWith('min') ? '≥' : '≤'}
              title={k}
              min={0}
              mixedLabel={k}
              value={(() => {
                const v = common(nodes, (n) => n[k]);
                return v === MIXED || v === null ? MIXED : v;
              })()}
              onChange={(v) => updateNodes(ids, { [k]: v } as Partial<DesignNode>, k)}
              onClear={() => updateNodes(ids, { [k]: null } as Partial<DesignNode>)}
            />
          ))}
        </div>
      </details>
      {parentFlow && (
        <Checkbox
          label={t('insp.absolute')}
          testId="insp-absolute"
          checked={nodes.every((n) => n.layoutPositioning === 'absolute')}
          onChange={(v) => {
            const p = getProject()!;
            updateNodes(ids, (n) => {
              if (!v) return { layoutPositioning: 'auto' };
              // Keep the current on-canvas position when leaving the flow.
              const r = worldRect(p, n.id);
              const o = parentOrigin(p, n.parentId);
              return r
                ? { layoutPositioning: 'absolute', x: Math.round(r.x - o.x), y: Math.round(r.y - o.y), width: r.width, height: r.height }
                : { layoutPositioning: 'absolute' };
            });
          }}
        />
      )}
    </Section>
  );
}

const ROLES: FrameRole[] = ['div', 'section', 'header', 'nav', 'main', 'footer', 'aside', 'article', 'button', 'input', 'link'];

export function AutoLayoutSection({ frames }: { frames: FrameNode[] }) {
  const t = useT();
  const ids = frames.map((f) => f.id);
  const mode = common(frames, (f) => f.layout.mode);
  const set = (patch: Partial<AutoLayout>, key?: string) =>
    updateNodes(ids, (n) => ({ layout: { ...(n as FrameNode).layout, ...patch } }) as Partial<DesignNode>, key);
  const pad = (i: number) => common(frames, (f) => f.layout.padding[i]!);
  const setPad = (i: number, v: number) =>
    updateNodes(
      ids,
      (n) => {
        const padding = [...(n as FrameNode).layout.padding] as AutoLayout['padding'];
        padding[i] = v;
        return { layout: { ...(n as FrameNode).layout, padding } } as Partial<DesignNode>;
      },
      `pad${i}`,
    );
  const enable = (m: AutoLayout['mode']) =>
    updateNodes(ids, (n) => {
      const f = n as FrameNode;
      const wasNone = f.layout.mode === 'none';
      const layout = { ...f.layout, mode: m };
      if (wasNone && m !== 'none' && f.layout.gap === 0 && f.layout.padding.every((p) => p === 0)) {
        layout.gap = 8;
        layout.padding = [8, 8, 8, 8];
      }
      const sizing = m === 'none' ? { horizontal: f.sizing.horizontal === 'hug' ? 'fixed' : f.sizing.horizontal, vertical: f.sizing.vertical === 'hug' ? 'fixed' : f.sizing.vertical } : f.sizing;
      return { layout, sizing } as Partial<DesignNode>;
    });

  return (
    <Section title={t('insp.layout')}>
      <Segmented
        value={mode}
        onChange={enable}
        options={[
          { value: 'none', label: t('insp.layoutNone'), icon: <Ban size={14} /> },
          { value: 'vertical', label: t('insp.layoutV'), icon: <ArrowDown size={14} /> },
          { value: 'horizontal', label: t('insp.layoutH'), icon: <ArrowRight size={14} /> },
        ]}
      />
      {mode !== 'none' && mode !== MIXED && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={<Columns3 size={12} />} title={t('insp.gap')} testId="insp-gap" min={0} value={common(frames, (f) => f.layout.gap)} onChange={(v) => set({ gap: v }, 'gap')} />
            <Checkbox label={t('insp.wrap')} checked={frames.every((f) => f.layout.wrap)} onChange={(v) => set({ wrap: v })} />
          </div>
          <TokenPicker nodes={frames} binding="gap" />
          <div className="text-[10.5px] text-fg-subtle">{t('insp.padding')}</div>
          <TokenPicker nodes={frames} binding="padding" />
          <div className="grid grid-cols-4 gap-1.5">
            {['↑', '→', '↓', '←'].map((l, i) => (
              <NumberField key={i} label={l} testId={`insp-pad-${i}`} min={0} precision={0} value={pad(i)} onChange={(v) => setPad(i, v)} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-2 text-[10.5px] text-fg-subtle">
            <span>{t('insp.primary')}</span>
            <span>{t('insp.counter')}</span>
          </div>
          <div className="-mt-1 grid grid-cols-2 gap-2">
            <SelectField
              title={t('insp.primary')}
              value={common(frames, (f) => f.layout.primaryAlign)}
              onChange={(v) => set({ primaryAlign: v })}
              options={[
                { value: 'start', label: `↦ ${t('insp.start')}` },
                { value: 'center', label: `↦ ${t('insp.center')}` },
                { value: 'end', label: `↦ ${t('insp.end')}` },
                { value: 'space-between', label: `↦ ${t('insp.between')}` },
              ]}
            />
            <SelectField
              title={t('insp.counter')}
              value={common(frames, (f) => f.layout.counterAlign)}
              onChange={(v) => set({ counterAlign: v })}
              options={[
                { value: 'start', label: `⊥ ${t('insp.start')}` },
                { value: 'center', label: `⊥ ${t('insp.center')}` },
                { value: 'end', label: `⊥ ${t('insp.end')}` },
              ]}
            />
          </div>
        </>
      )}
      <div className="grid grid-cols-2 items-center gap-2">
        <Checkbox label={t('insp.clip')} checked={frames.every((f) => f.clipContent)} onChange={(v) => updateNodes(ids, { clipContent: v } as Partial<DesignNode>)} />
        <SelectField
          title={t('insp.role')}
          value={common(frames, (f) => f.role)}
          onChange={(v) => updateNodes(ids, { role: v } as Partial<DesignNode>)}
          options={ROLES.map((r) => ({ value: r, label: `<${r === 'link' ? 'a' : r}>` }))}
        />
      </div>
    </Section>
  );
}
