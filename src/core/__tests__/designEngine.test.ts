import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { constraintOps } from '../constraints';
import { createFrame, createInstance, createProject, createRect, createText, solid } from '../factory';
import { expandInstance, virtualId } from '../instance';
import { applyOps, op, type DocOp } from '../ops';
import { breakpointChain, resolveNode } from '../resolve';
import type { FrameNode, Project } from '../schema';
import { nodeStyle } from '../style';
import { checkIntegrity, parseProject } from '../validate';

const apply = (p: Project, ops: DocOp[]) => produce(p, (d) => applyOps(d, ops));

function base() {
  const p = createProject('M2');
  const page = p.pages[0]!;
  const frame = createFrame({ parentId: page.id, width: 800, height: 600, name: 'Screen' });
  const rect = createRect({ parentId: frame.id, x: 700, y: 20, width: 80, height: 40 });
  const title = createText({ parentId: frame.id, x: 20, y: 20 }, { characters: 'Titolo' });
  return { p: apply(p, [op.insert([frame]), op.insert([rect]), op.insert([title])]), page, frame, rect, title };
}

describe('design tokens', () => {
  it('resolves bound properties and propagates token changes', () => {
    const { p, rect, title } = base();
    const tokenOps: DocOp[] = [
      { type: 'upsertToken', token: { kind: 'colors', value: { id: 'brand', name: 'brand/primary', value: '#0B5FFF', opacity: 1 } } },
      { type: 'upsertToken', token: { kind: 'text', value: { id: 'h1', name: 'Heading 1', fontFamily: 'Inter', fontSize: 48, fontWeight: 800, lineHeight: { unit: 'percent', value: 110 }, letterSpacing: -1 } } },
      { type: 'upsertToken', token: { kind: 'radius', value: { id: 'r-md', name: 'md', value: 12 } } },
    ];
    let q = apply(p, [...tokenOps, op.update(rect.id, { bindings: { fill: 'brand', radius: 'r-md' } }), op.update(title.id, { bindings: { text: 'h1' } })]);
    let r = resolveNode(q.nodes[rect.id]!, q.tokens, []);
    expect(r.fills.at(-1)).toMatchObject({ color: '#0B5FFF' });
    expect(r.radius).toEqual([12, 12, 12, 12]);
    expect(resolveNode(q.nodes[title.id]!, q.tokens, [])).toMatchObject({ fontSize: 48, fontWeight: 800 });

    // A change to the token updates every bound element.
    q = apply(q, [{ type: 'upsertToken', token: { kind: 'colors', value: { id: 'brand', name: 'brand/primary', value: '#C2185B', opacity: 1 } } }]);
    r = resolveNode(q.nodes[rect.id]!, q.tokens, []);
    expect(r.fills.at(-1)).toMatchObject({ color: '#C2185B' });
  });

  it('bakes values when a token is deleted and rejects bindings to missing tokens', () => {
    const { p, rect } = base();
    let q = apply(p, [
      { type: 'upsertToken', token: { kind: 'colors', value: { id: 'brand', name: 'brand', value: '#123456', opacity: 1 } } },
      op.update(rect.id, { bindings: { fill: 'brand' } }),
    ]);
    q = apply(q, [{ type: 'deleteToken', kind: 'colors', id: 'brand' }]);
    expect(q.nodes[rect.id]!.bindings).toEqual({});
    expect(q.nodes[rect.id]!.fills.at(-1)).toMatchObject({ color: '#123456' });
    expect(() => apply(q, [op.update(rect.id, { bindings: { fill: 'nope' } })])).toThrow(/not found/);
    expect(() =>
      apply(q, [
        { type: 'upsertToken', token: { kind: 'spacing', value: { id: 'a', name: 'sm', value: 4 } } },
        { type: 'upsertToken', token: { kind: 'spacing', value: { id: 'b', name: 'sm', value: 8 } } },
      ]),
    ).toThrow(/already exists/);
  });
});

describe('responsive overrides', () => {
  it('cascades desktop-first and validates overrides', () => {
    const { p, title } = base();
    let q = apply(p, [
      { type: 'setResponsive', id: title.id, breakpointId: 'bp-tablet', props: { fontSize: 32 } },
      { type: 'setResponsive', id: title.id, breakpointId: 'bp-mobile', props: { textAlign: 'center' } },
    ]);
    const chainMobile = breakpointChain(q.breakpoints, 'bp-mobile');
    expect(chainMobile).toEqual(['bp-tablet', 'bp-mobile']);
    expect(resolveNode(q.nodes[title.id]!, q.tokens, chainMobile)).toMatchObject({ fontSize: 32, textAlign: 'center' });
    expect(resolveNode(q.nodes[title.id]!, q.tokens, [])).toMatchObject({ fontSize: 16, textAlign: 'left' });
    expect(() => apply(q, [{ type: 'setResponsive', id: title.id, breakpointId: 'bp-mobile', props: { fontSize: -3 } }])).toThrow();
    q = apply(q, [{ type: 'clearResponsive', id: title.id, breakpointId: 'bp-tablet', keys: ['fontSize'] }]);
    expect(q.nodes[title.id]!.responsive['bp-tablet']).toBeUndefined();
    // Removing a breakpoint prunes its overrides.
    q = apply(q, [{ type: 'setBreakpoints', breakpoints: q.breakpoints.filter((b) => b.id !== 'bp-mobile') }]);
    expect(q.nodes[title.id]!.responsive).toEqual({});
  });
});

describe('constraints', () => {
  it('repositions children on parent resize and maps to CSS', () => {
    const { p, frame, rect } = base();
    const q = apply(p, [op.update(rect.id, { constraints: { horizontal: 'end', vertical: 'start' } })]);
    const ops = constraintOps(q, frame.id, 1000, 600);
    expect(ops).toEqual([{ type: 'updateNode', id: rect.id, props: { x: 900 } }]);
    const css = nodeStyle(q.nodes[rect.id]!, { parent: q.nodes[frame.id]! });
    expect(css.right).toBe('20px');
    expect(css.left).toBeUndefined();
    const stretched = apply(q, [op.update(rect.id, { constraints: { horizontal: 'stretch', vertical: 'scale' } })]);
    expect(constraintOps(stretched, frame.id, 1000, 1200)).toEqual([{ type: 'updateNode', id: rect.id, props: { y: 40, width: 280, height: 80 } }]);
  });
});

describe('components and instances', () => {
  function withComponent() {
    const { p, page } = base();
    const btn = createFrame({ parentId: page.id, x: 0, y: 800, width: 160, height: 44, name: 'Button' }, { fills: [solid('#6D5BFF')], layout: { mode: 'horizontal', gap: 8, padding: [12, 20, 12, 20], primaryAlign: 'center', counterAlign: 'center', wrap: false } });
    const label = createText({ parentId: btn.id }, { characters: 'Invia', layoutPositioning: 'auto' });
    btn.childIds = [label.id];
    let q = apply(p, [op.insert([btn, label]), { type: 'setComponent', id: btn.id, component: { set: 'Button', variant: { State: 'Default' }, description: '' } }]);
    const inst = createInstance({ parentId: page.id, x: 400, y: 800 }, q.nodes[btn.id] as FrameNode);
    q = apply(q, [op.insert([inst])]);
    return { q, page, btn, label, inst };
  }

  it('expands instances with overrides and propagates main component edits', () => {
    const { btn, label, inst, q: q0 } = withComponent();
    let q = apply(q0, [{ type: 'setInstanceOverride', id: inst.id, sourceId: label.id, props: { characters: 'Acquista' } }]);
    let exp = expandInstance(q, q.nodes[inst.id] as never)!;
    expect(exp.nodes[virtualId(inst.id, label.id)]).toMatchObject({ type: 'text', characters: 'Acquista' });
    // Editing the main component propagates to instances (non-overridden props).
    q = apply(q, [op.update(label.id, { fontWeight: 700, characters: 'Invia ordine' }), op.update(btn.id, { fills: [solid('#111111')] })]);
    exp = expandInstance(q, q.nodes[inst.id] as never)!;
    expect(exp.nodes[virtualId(inst.id, label.id)]).toMatchObject({ characters: 'Acquista', fontWeight: 700 });
    expect(exp.root.fills[0]).toMatchObject({ color: '#111111' });
    expect(checkIntegrity(q)).toEqual([]);
    expect(parseProject(JSON.parse(JSON.stringify(q))).nodes[inst.id]!.type).toBe('instance');
  });

  it('rejects invalid overrides and component cycles', () => {
    const { q, btn, label, inst } = withComponent();
    expect(() => apply(q, [{ type: 'setInstanceOverride', id: inst.id, sourceId: label.id, props: { fontSize: 0 } }])).toThrow();
    const self = createInstance({ parentId: btn.id }, q.nodes[btn.id] as FrameNode);
    expect(() => apply(q, [op.insert([self])])).toThrow(/itself/);
    expect(() => apply(q, [{ type: 'updateNode', id: inst.id, props: { componentId: 'x' } }])).toThrow(/cannot be updated/);
  });

  it('detaches instances explicitly and when the main component is deleted', () => {
    const { q, btn, label, inst } = withComponent();
    const q1 = apply(q, [{ type: 'setInstanceOverride', id: inst.id, sourceId: label.id, props: { characters: 'Ok' } }, { type: 'deleteNode', id: btn.id }]);
    const detached = q1.nodes[inst.id]!;
    expect(detached.type).toBe('frame');
    const child = q1.nodes[detached.childIds[0]!]!;
    expect(child).toMatchObject({ type: 'text', characters: 'Ok' });
    expect(checkIntegrity(q1)).toEqual([]);
  });

  it('switches variants within a component set', () => {
    const { q, btn, inst, page } = withComponent();
    const hover = createFrame({ parentId: page.id, x: 200, y: 800, width: 160, height: 44, name: 'Button hover' }, { fills: [solid('#4A3BDB')] });
    let q2 = apply(q, [op.insert([hover]), { type: 'setComponent', id: hover.id, component: { set: 'Button', variant: { State: 'Hover' }, description: '' } }]);
    q2 = apply(q2, [{ type: 'setInstanceComponent', id: inst.id, componentId: hover.id }]);
    expect(expandInstance(q2, q2.nodes[inst.id] as never)!.root.fills[0]).toMatchObject({ color: '#4A3BDB' });
    expect(() => apply(q2, [{ type: 'setInstanceComponent', id: inst.id, componentId: inst.id }])).toThrow();
    void btn;
  });
});

describe('HTML export of the design engine', () => {
  it('emits token variables, breakpoint media queries and expanded instances', async () => {
    const { exportHtml } = await import('../workflow/htmlExport');
    const { p, page, frame, title } = base();
    const btn = createFrame({ parentId: page.id, x: 0, y: 900, width: 120, height: 40, name: 'Btn' }, { fills: [solid('#000000')] });
    const label = createText({ parentId: btn.id, x: 10, y: 10 }, { characters: 'Comp label' });
    btn.childIds = [label.id];
    let q = apply(p, [
      { type: 'upsertToken', token: { kind: 'colors', value: { id: 'brand', name: 'Brand Primary', value: '#0B5FFF', opacity: 1 } } },
      op.update(frame.id, { bindings: { fill: 'brand' } }),
      { type: 'setResponsive', id: title.id, breakpointId: 'bp-mobile', props: { fontSize: 12 } },
      op.insert([btn, label]),
      { type: 'setComponent', id: btn.id, component: { set: 'Btn', variant: {}, description: '' } },
    ]);
    const inst = createInstance({ parentId: frame.id, x: 100, y: 100 }, q.nodes[btn.id] as FrameNode);
    q = apply(q, [op.insert([inst]), { type: 'setInstanceOverride', id: inst.id, sourceId: label.id, props: { characters: 'Override <b>' } }]);
    const html = await exportHtml(q, [frame.id], 'T', {});
    expect(html).toContain('--color-brand-primary: rgb(11, 95, 255);');
    expect(html).toContain('background: var(--color-brand-primary);');
    expect(html).toMatch(/@media \(max-width: 640px\) \{\n\.p-\d+ \{ font-size: 12px; \}/);
    expect(html).toContain('Override &lt;b&gt;');
    expect(html).not.toContain('Comp label');
  });
});
