/** Inspector sections for constraints, breakpoints, components/instances and token bindings. */
import { Component, Diamond, Link2, Link2Off, RotateCcw, Unlink } from 'lucide-react';
import { useState } from 'react';
import { createInstance } from '@/core/factory';
import { enclosingComponents, getMainComponent, parseVirtualId, variantSiblings } from '@/core/instance';
import { op, type DocOp } from '@/core/ops';
import type { Constraint, DesignNode, FrameNode, InstanceNode, TokenBindings, TokenKind } from '@/core/schema';
import { isInFlow } from '@/core/tree';
import { insertTree, resolveInsertTarget, updateNodes } from '@/editor/actions';
import { openInCanvas } from '@/editor/workflowActions';
import { useT } from '@/i18n';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { Checkbox, ColorField, IconButton, MIXED, NumberField, Section, SelectField } from '@/ui/common/controls';
import { DESIGN_ICONS } from '@/ui/common/icons';
import { common } from './helpers';

const toast = (m: string) => useEditorStore.getState().showToast(m, 'error');

function run(ops: DocOp[], label: string) {
  const res = dispatch(ops, { label });
  if (!res.ok) toast(res.error);
  return res.ok;
}

/* ------------------------------------------------------------------ */
/* Breakpoint banner                                                   */
/* ------------------------------------------------------------------ */

export function BreakpointBanner({ ids }: { ids: string[] }) {
  const t = useT();
  const bpId = useEditorStore((s) => s.breakpointId);
  const project = useDocStore((s) => s.project);
  const bp = project?.breakpoints.find((b) => b.id === bpId);
  if (!bp || !project) return null;
  const overridden = ids.filter((id) => project.nodes[id]?.responsive[bp.id]);
  return (
    <div className="border-b border-line bg-accent/10 px-3 py-2 text-[11px] leading-4 text-fg" data-testid="bp-banner">
      {t('bp.editing', { name: bp.name, w: bp.maxWidth })}
      {overridden.length > 0 && (
        <button
          data-testid="bp-reset"
          className="mt-1.5 flex items-center gap-1 text-accent hover:underline"
          onClick={() => run(overridden.map((id) => ({ type: 'clearResponsive', id, breakpointId: bp.id })), 'Reset overrides')}
        >
          <RotateCcw size={11} /> {t('bp.reset')}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Constraints                                                         */
/* ------------------------------------------------------------------ */

export function ConstraintsSection({ nodes }: { nodes: DesignNode[] }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const eligible = nodes.every((n) => {
    const p = project.nodes[n.parentId];
    return p && (p.type === 'frame' || p.type === 'group') && !isInFlow(project, n);
  });
  if (!eligible) return null;
  const ids = nodes.map((n) => n.id);
  const opts = (axis: 'h' | 'v') =>
    (['start', 'end', 'center', 'stretch', 'scale'] as Constraint[]).map((v) => ({
      value: v,
      label: v === 'start' || v === 'end' ? t(`cons.${v}.${axis}`) : t(`cons.${v}`),
    }));
  return (
    <Section title={t('cons.title')}>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          title={t('cons.h')}
          testId="cons-h"
          value={common(nodes, (n) => n.constraints.horizontal)}
          options={opts('h').map((o) => ({ ...o, label: `↔ ${o.label}` }))}
          onChange={(v) => updateNodes(ids, (n) => ({ constraints: { ...n.constraints, horizontal: v } }))}
        />
        <SelectField
          title={t('cons.v')}
          testId="cons-v"
          value={common(nodes, (n) => n.constraints.vertical)}
          options={opts('v').map((o) => ({ ...o, label: `↕ ${o.label}` }))}
          onChange={(v) => updateNodes(ids, (n) => ({ constraints: { ...n.constraints, vertical: v } }))}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Token binding picker                                                */
/* ------------------------------------------------------------------ */

const KIND_OF: Record<keyof TokenBindings, TokenKind> = { fill: 'colors', stroke: 'colors', text: 'text', radius: 'radius', gap: 'spacing', padding: 'spacing', shadow: 'shadows' };

export function TokenPicker({ nodes, binding }: { nodes: DesignNode[]; binding: keyof TokenBindings }) {
  const t = useT();
  const tokens = useDocStore((s) => s.project?.tokens);
  const project = useDocStore((s) => s.project);
  if (!tokens || !project) return null;
  // Bindings live on stored layers (not on instance layers).
  const real = nodes.filter((n) => project.nodes[n.id]);
  if (!real.length || real.length !== nodes.length) return null;
  const list = tokens[KIND_OF[binding]] as { id: string; name: string; value?: unknown }[];
  const current = common(real, (n) => project.nodes[n.id]!.bindings[binding] ?? '');
  const ids = real.map((n) => n.id);
  const set = (id: string) =>
    run(
      ids.map((nid) => {
        const b = { ...project.nodes[nid]!.bindings } as Record<string, string>;
        if (id) b[binding] = id;
        else delete b[binding];
        return op.update(nid, { bindings: b });
      }),
      id ? 'Bind token' : 'Detach token',
    );
  if (!list.length && !current) return null;
  const boundName = current && current !== MIXED ? list.find((x) => x.id === current)?.name : null;
  return (
    <div className="flex items-center gap-1" data-testid={`token-picker-${binding}`}>
      <span className={boundName ? 'text-accent' : 'text-fg-subtle'} title={boundName ? t('tok.bound') : undefined}>
        {boundName ? <Link2 size={12} /> : <Diamond size={11} />}
      </span>
      <div className="min-w-0 flex-1">
        <SelectField
          testId={`token-select-${binding}`}
          value={current === MIXED ? MIXED : (current as string)}
          options={[{ value: '', label: t('tok.none') }, ...list.map((x) => ({ value: x.id, label: x.name }))]}
          onChange={(v) => set(v)}
        />
      </div>
      {boundName && (
        <IconButton label={t('tok.detach')} onClick={() => set('')}>
          <Link2Off size={12} />
        </IconButton>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

function parseVariant(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const [k, ...rest] = line.split('=');
    const key = k?.trim().slice(0, 40);
    const value = rest.join('=').trim().slice(0, 40);
    if (key && value) out[key] = value;
  }
  return out;
}

export function ComponentSection({ frame }: { frame: FrameNode }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const raw = project.nodes[frame.id];
  const [variantText, setVariantText] = useState<string | null>(null);
  if (!raw || raw.type !== 'frame') return null;
  const nested = enclosingComponents(project, raw.parentId).length > 0;
  const c = raw.component;
  if (!c) {
    return (
      <Section title={t('comp.title')}>
        <button
          data-testid="comp-create"
          disabled={nested}
          title={nested ? t('comp.nested') : undefined}
          onClick={() => run([{ type: 'setComponent', id: raw.id, component: { set: raw.name, variant: {}, description: '' } }], 'Create component')}
          className="flex h-7 items-center justify-center gap-1.5 rounded-md bg-field text-[11px] text-fg hover:bg-field-hover disabled:opacity-40"
        >
          <Component size={13} /> {t('comp.create')}
        </button>
      </Section>
    );
  }
  const variantString = Object.entries(c.variant)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const update = (patch: Partial<typeof c>) => run([{ type: 'setComponent', id: raw.id, component: { ...c, ...patch } }], 'Edit component');
  return (
    <Section title={`◆ ${t('comp.title')}`}>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] text-fg-muted">{t('comp.set')}</span>
        <input
          key={c.set}
          defaultValue={c.set}
          data-testid="comp-set"
          onBlur={(e) => e.target.value !== c.set && update({ set: e.target.value.slice(0, 100) })}
          className="h-7 rounded-md border border-transparent bg-field px-2 text-[11px] text-fg outline-none focus:border-accent"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10.5px] text-fg-muted">{t('comp.variant')}</span>
        <textarea
          data-testid="comp-variant"
          rows={2}
          value={variantText ?? variantString}
          onChange={(e) => setVariantText(e.target.value)}
          onBlur={() => {
            if (variantText !== null) update({ variant: parseVariant(variantText) });
            setVariantText(null);
          }}
          className="resize-y rounded-md border border-transparent bg-field px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
        />
        <span className="text-[10.5px] text-fg-subtle">{t('comp.variantHelp')}</span>
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          data-testid="comp-instance"
          onClick={() => {
            const p = getProject()!;
            const target = p.nodes[raw.parentId] ? raw.parentId : useEditorStore.getState().pageId!;
            const inst = createInstance({ parentId: target }, p.nodes[raw.id] as FrameNode);
            insertTree({ root: inst, nodes: [inst] }, target, { x: (useEditorStore.getState().rects[raw.id]?.x ?? 0) + raw.width + 80, y: useEditorStore.getState().rects[raw.id]?.y ?? 0 }, 'Create instance');
          }}
          className="h-7 rounded-md bg-accent-strong text-[11px] font-medium text-white hover:bg-accent"
        >
          {t('comp.instance')}
        </button>
        <button
          onClick={() => run([{ type: 'setComponent', id: raw.id, component: null }], 'Remove component')}
          className="h-7 rounded-md bg-field text-[11px] text-fg-muted hover:bg-field-hover hover:text-fg"
        >
          {t('comp.remove')}
        </button>
      </div>
    </Section>
  );
}

export function InstanceSection({ node }: { node: InstanceNode }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const inst = project.nodes[node.id];
  if (!inst || inst.type !== 'instance') return null;
  const main = getMainComponent(project, inst);
  const goMain = () => {
    if (!main) return;
    let cur: DesignNode = main;
    while (project.nodes[cur.parentId]) cur = project.nodes[cur.parentId]!;
    openInCanvas(cur.parentId, [main.id]);
  };
  const siblings = main ? variantSiblings(project, main) : [];
  const props = [...new Set(siblings.flatMap((s) => Object.keys(s.component!.variant)))];
  const choose = (key: string, value: string) => {
    if (!main) return;
    const wanted = { ...main.component!.variant, [key]: value };
    const match =
      siblings.find((s) => Object.entries(wanted).every(([k, v]) => s.component!.variant[k] === v)) ??
      siblings.find((s) => s.component!.variant[key] === value);
    if (match && match.id !== main.id) run([{ type: 'setInstanceComponent', id: inst.id, componentId: match.id }], 'Switch variant');
  };
  const overrideCount = Object.keys(inst.overrides).length;
  return (
    <Section title={`◇ ${t('comp.instanceOf')}`}>
      {!main && <p className="text-[11px] text-danger">{t('comp.missing')}</p>}
      {main && (
        <button className="flex items-center gap-1.5 text-left text-[11px] text-accent hover:underline" onClick={goMain} data-testid="inst-go-main">
          <Component size={12} /> {main.name} · {t('comp.goMain')}
        </button>
      )}
      {props.map((key) => {
        const values = [...new Set(siblings.map((s) => s.component!.variant[key]).filter(Boolean) as string[])];
        return (
          <label key={key} className="grid grid-cols-[80px_1fr] items-center gap-2">
            <span className="truncate text-[11px] text-fg-muted">{key}</span>
            <SelectField testId={`inst-variant-${key}`} value={main?.component?.variant[key] ?? ''} options={values.map((v) => ({ value: v, label: v }))} onChange={(v) => choose(key, v)} />
          </label>
        );
      })}
      <div className="grid grid-cols-2 gap-1.5">
        <button
          disabled={!overrideCount}
          onClick={() => run([{ type: 'resetInstanceOverride', id: inst.id }], 'Reset overrides')}
          className="flex h-7 items-center justify-center gap-1 rounded-md bg-field text-[11px] text-fg-muted hover:bg-field-hover hover:text-fg disabled:opacity-40"
        >
          <RotateCcw size={11} /> {t('comp.reset')}
        </button>
        <button
          data-testid="inst-detach"
          disabled={!main}
          onClick={() => run([{ type: 'detachInstance', id: inst.id }], 'Detach instance')}
          className="flex h-7 items-center justify-center gap-1 rounded-md bg-field text-[11px] text-fg-muted hover:bg-field-hover hover:text-fg disabled:opacity-40"
        >
          <Unlink size={11} /> {t('comp.detach')}
        </button>
      </div>
    </Section>
  );
}

/** Inspector for a layer inside an instance: only overridable properties. */
export function InstanceLayerInspector({ node }: { node: DesignNode }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const v = parseVirtualId(node.id)!;
  const inst = project.nodes[v.instanceId] as InstanceNode | undefined;
  const nested = v.sourceId.includes('__');
  const overridden = inst?.overrides[v.sourceId];
  const ids = [node.id];
  const solid = [...node.fills].reverse().find((f) => f.type === 'solid' && f.visible);
  return (
    <div data-testid="instance-layer-inspector">
      <div className="flex h-9 items-center border-b border-line px-3 text-[11px] font-semibold">
        <span className="mr-1.5 uppercase tracking-wide text-fg-subtle">{t('comp.layer')}</span>
        <span className="truncate">{node.name}</span>
      </div>
      <p className="border-b border-line px-3 py-2 text-[10.5px] leading-4 text-fg-subtle">{t('comp.layerHelp')}</p>
      {nested ? null : (
        <Section title={node.type === 'text' ? t('insp.text') : t('insp.layer')}>
          {node.type === 'text' && (
            <textarea
              data-testid="inst-layer-characters"
              key={node.characters}
              defaultValue={node.characters}
              rows={3}
              onBlur={(e) => e.target.value !== node.characters && updateNodes(ids, { characters: e.target.value } as Partial<DesignNode>)}
              className="w-full resize-y rounded-md border border-transparent bg-field px-2 py-1.5 text-[11px] text-fg outline-none focus:border-accent"
            />
          )}
          {node.type === 'text' && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Aa" value={node.fontSize} min={1} onChange={(fontSize) => updateNodes(ids, { fontSize } as Partial<DesignNode>, 'ifs')} />
              <SelectField value={node.fontWeight} options={[300, 400, 500, 600, 700, 800].map((w) => ({ value: w, label: String(w) }))} onChange={(fontWeight) => updateNodes(ids, { fontWeight } as Partial<DesignNode>)} />
            </div>
          )}
          {node.type === 'icon' && (
            <SelectField value={node.icon} options={Object.keys(DESIGN_ICONS).map((k) => ({ value: k as typeof node.icon, label: k }))} onChange={(icon) => updateNodes(ids, { icon } as Partial<DesignNode>)} />
          )}
          {node.type === 'image' && (
            <SelectField
              value={node.assetId ?? ''}
              options={[{ value: '', label: t('insp.noImage') }, ...Object.values(project.assets).map((a) => ({ value: a.id, label: a.name }))]}
              onChange={(assetId) => updateNodes(ids, { assetId: assetId || null } as Partial<DesignNode>)}
            />
          )}
          {solid && solid.type === 'solid' && (
            <ColorField
              testId="inst-layer-color"
              color={solid.color}
              opacity={solid.opacity}
              onChange={(color, opacity) => updateNodes(ids, { fills: [...node.fills.slice(0, -1), { ...solid, color, opacity: opacity ?? solid.opacity }] }, 'ifill')}
            />
          )}
          <Checkbox label={t('left.show')} checked={node.visible} onChange={(visible) => updateNodes(ids, { visible })} />
          {overridden && (
            <button
              className="flex items-center gap-1 text-[11px] text-accent hover:underline"
              onClick={() => run([{ type: 'resetInstanceOverride', id: v.instanceId, sourceId: v.sourceId }], 'Reset layer')}
            >
              <RotateCcw size={11} /> {t('comp.resetLayer')}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}

/** Inserts an instance of a main component into the current insertion target. */
export function insertInstance(componentId: string) {
  const project = getProject();
  const main = project?.nodes[componentId];
  if (!project || !main || main.type !== 'frame' || !main.component) return;
  const target = resolveInsertTarget(project);
  // An instance cannot go inside its own component (or one that depends on it): fall back to the page.
  const safe = enclosingComponents(project, target).length ? useEditorStore.getState().pageId! : target;
  const inst = createInstance({ parentId: safe }, main);
  insertTree({ root: inst, nodes: [inst] }, safe, undefined, 'Insert instance');
}
