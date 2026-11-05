import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProject } from '../factory';
import { createId } from '../ids';
import { applyOps, type DocOp } from '../ops';
import type { Project, Workflow, WorkflowNode } from '../schema';
import { checkIntegrity, parseProject } from '../validate';
import { getSpec, type DesignValue, type ReportValue } from '../workflow/catalog';
import { contrastRatio } from '../workflow/color';
import { runWorkflow, type CacheEntry, type EngineHost } from '../workflow/engine';
import { parseOutline } from '../workflow/runners';

function makeHost(initial: Project): EngineHost & { project: Project; transactions: string[] } {
  const host = {
    project: initial,
    transactions: [] as string[],
    aiAvailable: false,
    lang: 'it' as const,
    getProject: () => host.project,
    apply(ops: DocOp[], label: string) {
      host.project = produce(host.project, (d) => applyOps(d, ops));
      host.transactions.push(label);
      return host.project;
    },
  };
  return host;
}

const wn = (kind: string, params: Record<string, unknown> = {}, x = 0): WorkflowNode => ({
  id: createId(),
  kind,
  label: getSpec(kind)!.label.it,
  position: { x, y: 0 },
  params: { ...getSpec(kind)!.defaults, ...params },
});

function pipeline() {
  const brief = wn('brief-input', { text: 'Sito per un concierge auto.\n- Home\n- Servizi\n- Contatti' }, 0);
  const sitemap = wn('sitemap', {}, 1);
  const wire = wn('wireframe', { device: 'desktop', pageName: 'Wireframe', brand: 'Auto' }, 2);
  const ds = wn('design-system', { primary: '#0B5FFF' }, 2);
  const styled = wn('apply-styles', {}, 3);
  const a11y = wn('a11y-check', {}, 4);
  const cond = wn('condition', { maxErrors: 0, maxWarnings: 50 }, 5);
  const e = (s: WorkflowNode, sp: string, t: WorkflowNode, tp: string) => ({ id: createId(), source: s.id, sourcePort: sp, target: t.id, targetPort: tp });
  const wf: Workflow = {
    id: createId(),
    name: 'Pipeline',
    nodes: [brief, sitemap, wire, ds, styled, a11y, cond],
    edges: [e(brief, 'brief', sitemap, 'brief'), e(sitemap, 'sitemap', wire, 'sitemap'), e(wire, 'design', styled, 'design'), e(ds, 'styles', styled, 'styles'), e(styled, 'design', a11y, 'design'), e(a11y, 'report', cond, 'report')],
  };
  const project = produce(createProject('WF'), (d) => applyOps(d, [{ type: 'createWorkflow', workflow: wf }]));
  return { project, wf: project.workflows[0]!, ids: { brief, sitemap, wire, ds, styled, a11y, cond } };
}

describe('workflow graph ops', () => {
  it('rejects incompatible, duplicate and cyclic connections', () => {
    const { project, wf, ids } = pipeline();
    const add = (edge: object) => () => produce(project, (d) => applyOps(d, [{ type: 'addWorkflowEdge', workflowId: wf.id, edge: { id: createId(), ...edge } as never }]));
    expect(add({ source: ids.brief.id, sourcePort: 'brief', target: ids.a11y.id, targetPort: 'design' })).toThrow(/Incompatible/);
    expect(add({ source: ids.ds.id, sourcePort: 'styles', target: ids.styled.id, targetPort: 'styles' })).toThrow(/already connected/);
    const branch = wn('branch');
    const p2 = produce(project, (d) => applyOps(d, [{ type: 'addWorkflowNodes', workflowId: wf.id, nodes: [branch] }, { type: 'addWorkflowEdge', workflowId: wf.id, edge: { id: createId(), source: ids.cond.id, sourcePort: 'pass', target: branch.id, targetPort: 'in' } }]));
    expect(() => produce(p2, (d) => applyOps(d, [{ type: 'addWorkflowEdge', workflowId: wf.id, edge: { id: createId(), source: branch.id, sourcePort: 'a', target: ids.cond.id, targetPort: 'report' } }]))).toThrow();
  });

  it('validates node params against the catalog', () => {
    const { project, wf, ids } = pipeline();
    expect(() => produce(project, (d) => applyOps(d, [{ type: 'updateWorkflowNode', workflowId: wf.id, id: ids.ds.id, props: { params: { primary: 'blue' } } }]))).toThrow(/Invalid parameters/);
    expect(() => produce(project, (d) => applyOps(d, [{ type: 'addWorkflowNodes', workflowId: wf.id, nodes: [{ ...wn('brief-input'), kind: 'run-shell' }] }]))).toThrow(/Unknown node kind/);
  });

  it('round-trips through project validation', () => {
    const { project } = pipeline();
    expect(parseProject(JSON.parse(JSON.stringify(project))).workflows).toHaveLength(1);
  });
});

describe('workflow engine', () => {
  it('runs the deterministic pipeline and creates editable frames', async () => {
    const { project, wf, ids } = pipeline();
    const host = makeHost(project);
    const cache = new Map<string, CacheEntry>();
    const res = await runWorkflow(wf, cache, host);
    expect(res.errors).toEqual({});
    const wireDesign = cache.get(ids.wire.id)!.outputs.design as DesignValue;
    expect(wireDesign.frameIds).toHaveLength(3);
    const styled = cache.get(ids.styled.id)!.outputs.design as DesignValue;
    expect(styled.frameIds).toHaveLength(3);
    expect(checkIntegrity(host.project)).toEqual([]);
    const page = host.project.pages.find((p) => p.name === 'Wireframe')!;
    expect(page.childIds).toHaveLength(6);
    // Styled copy uses the primary color on buttons.
    const button = Object.values(host.project.nodes).find((n) => n.type === 'frame' && n.role === 'button' && n.fills[0]?.type === 'solid' && n.fills[0].color === '#0B5FFF');
    expect(button).toBeDefined();
    const report = cache.get(ids.a11y.id)!.outputs.report as ReportValue;
    expect(report.checked).toBeGreaterThan(20);
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reuses cache, regenerates on param changes without duplicating, and tracks design edits', async () => {
    const { project, wf, ids } = pipeline();
    const host = makeHost(project);
    const cache = new Map<string, CacheEntry>();
    await runWorkflow(wf, cache, host);
    const tx = host.transactions.length;
    const second = await runWorkflow(wf, cache, host);
    expect(Object.values(second.statuses).every((s) => s === 'cached')).toBe(true);
    expect(host.transactions.length).toBe(tx);

    // Change the design-system primary color: only downstream nodes re-run; old styled frames are replaced.
    host.apply([{ type: 'updateWorkflowNode', workflowId: wf.id, id: ids.ds.id, props: { params: { primary: '#C2185B' } } }], 'edit');
    const wf2 = host.project.workflows[0]!;
    const oldStyled = (cache.get(ids.styled.id)!.outputs.design as DesignValue).frameIds;
    const third = await runWorkflow(wf2, cache, host);
    expect(third.statuses[ids.wire.id]).toBe('cached');
    expect(third.statuses[ids.styled.id]).toBe('done');
    expect(oldStyled.every((id) => !host.project.nodes[id])).toBe(true);
    expect(host.project.pages.find((p) => p.name === 'Wireframe')!.childIds).toHaveLength(6);

    // Editing a generated frame by hand invalidates the downstream check.
    const styledIds = (cache.get(ids.styled.id)!.outputs.design as DesignValue).frameIds;
    host.apply([{ type: 'updateNode', id: styledIds[0]!, props: { name: 'Edited by hand' } }], 'manual');
    const fourth = await runWorkflow(wf2, cache, host, { targetId: ids.a11y.id });
    expect(fourth.statuses[ids.a11y.id]).toBe('done');
    expect(fourth.statuses[ids.cond.id]).toBeUndefined();
  });

  it('routes conditions and skips inactive branches', async () => {
    const { project, wf, ids } = pipeline();
    const host = makeHost(project);
    const onPass = wn('branch');
    const onFail = wn('branch');
    host.apply(
      [
        // Near-white text on white produces WCAG contrast errors → the condition must fail.
        { type: 'updateWorkflowNode', workflowId: wf.id, id: ids.ds.id, props: { params: { text: '#F2F2F2' } } },
        { type: 'updateWorkflowNode', workflowId: wf.id, id: ids.cond.id, props: { params: { maxWarnings: 0, maxErrors: 0 } } },
        { type: 'addWorkflowNodes', workflowId: wf.id, nodes: [onPass, onFail] },
        { type: 'addWorkflowEdge', workflowId: wf.id, edge: { id: createId(), source: ids.cond.id, sourcePort: 'pass', target: onPass.id, targetPort: 'in' } },
        { type: 'addWorkflowEdge', workflowId: wf.id, edge: { id: createId(), source: ids.cond.id, sourcePort: 'fail', target: onFail.id, targetPort: 'in' } },
      ],
      'setup',
    );
    const res = await runWorkflow(host.project.workflows[0]!, new Map(), host);
    expect(res.statuses[ids.cond.id]).toBe('done');
    expect(res.statuses[onPass.id]).toBe('skipped');
    expect(res.statuses[onFail.id]).toBe('done');

    // And with readable colors the same graph takes the "pass" branch.
    host.apply([{ type: 'updateWorkflowNode', workflowId: wf.id, id: ids.ds.id, props: { params: { text: '#14151A' } } }], 'fix');
    const res2 = await runWorkflow(host.project.workflows[0]!, new Map(), host);
    expect(res2.statuses[onPass.id]).toBe('done');
    expect(res2.statuses[onFail.id]).toBe('skipped');
  });

  it('never fakes AI results', async () => {
    const brief = wn('brief-input', { text: 'Ciao' });
    const ux = wn('ux-analysis');
    const wf: Workflow = { id: createId(), name: 'AI', nodes: [brief, ux], edges: [{ id: createId(), source: brief.id, sourcePort: 'brief', target: ux.id, targetPort: 'brief' }] };
    const project = produce(createProject('AI'), (d) => applyOps(d, [{ type: 'createWorkflow', workflow: wf }]));
    const res = await runWorkflow(project.workflows[0]!, new Map(), makeHost(project));
    expect(res.statuses[ux.id]).toBe('unavailable');
    expect(res.errors[ux.id]).toMatch(/provider AI/);
  });

  it('reports missing required inputs', async () => {
    const check = wn('a11y-check');
    const wf: Workflow = { id: createId(), name: 'X', nodes: [check], edges: [] };
    const project = produce(createProject('X'), (d) => applyOps(d, [{ type: 'createWorkflow', workflow: wf }]));
    const res = await runWorkflow(project.workflows[0]!, new Map(), makeHost(project));
    expect(res.statuses[check.id]).toBe('error');
    expect(res.errors[check.id]).toMatch(/non collegato/);
  });
});

describe('workflow helpers', () => {
  it('parses indented outlines into a sitemap', () => {
    const pages = parseOutline('Home\nServizi\n  Noleggio\n  Manutenzione\n- Contatti');
    expect(pages.map((p) => [p.name, p.depth])).toEqual([
      ['Home', 0],
      ['Servizi', 0],
      ['Noleggio', 1],
      ['Manutenzione', 1],
      ['Contatti', 0],
    ]);
    expect(pages[1]!.children).toEqual(['Noleggio', 'Manutenzione']);
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });
});

describe('design system', () => {
  it('prefers white text on saturated primaries when it passes AA', async () => {
    const { readableOn } = await import('../workflow/color');
    expect(readableOn('#6D5BFF')).toBe('#FFFFFF');
    expect(readableOn('#FFD400')).toBe('#000000');
    expect(readableOn('#0B5FFF')).toBe('#FFFFFF');
  });
});

describe('design system → tokens', () => {
  it('writes project tokens and binds styled layers to them', async () => {
    const { resolveNode } = await import('../resolve');
    const { project, wf, ids } = pipeline();
    const host = makeHost(project);
    host.apply([{ type: 'updateWorkflowNode', workflowId: wf.id, id: ids.ds.id, props: { params: { writeTokens: true } } }], 'x');
    const cache = new Map<string, CacheEntry>();
    const res = await runWorkflow(host.project.workflows[0]!, cache, host);
    expect(res.errors).toEqual({});
    expect(host.project.tokens.colors.map((c) => c.name)).toContain('ds/primary');
    const styled = (cache.get(ids.styled.id)!.outputs.design as DesignValue).frameIds;
    const buttons = Object.values(host.project.nodes).filter((n) => n.type === 'frame' && n.role === 'button' && styled.some((r) => host.project.nodes[r] && JSON.stringify(n).length > 0) && n.bindings.fill);
    expect(buttons.length).toBeGreaterThan(0);
    // Editing the token restyles the bound layers.
    const primary = host.project.tokens.colors.find((c) => c.name === 'ds/primary')!;
    host.apply([{ type: 'upsertToken', token: { kind: 'colors', value: { ...primary, value: '#00A86B' } } }], 'edit token');
    const r = resolveNode(host.project.nodes[buttons[0]!.id]!, host.project.tokens, []);
    expect(r.fills.at(-1)).toMatchObject({ color: '#00A86B' });
  });
});
