import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { runDesignAgent } from '../ai/agent';
import { AI_PLAN_JSON_SCHEMA, parsePlan, planToOps, type AiAction } from '../ai/plan';
import type { AiProvider, GenerateRequest } from '../ai/provider';
import { createClaudeProvider } from '../ai/providers/claude';
import { createOllamaProvider } from '../ai/providers/ollama';
import { createFrame, createProject } from '../factory';
import { createId } from '../ids';
import { applyOps, op } from '../ops';
import type { Project } from '../schema';
import { checkIntegrity } from '../validate';

const act = (a: Partial<AiAction>): AiAction =>
  ({
    action: 'create', ref: null, id: null, parent: null, kind: null, name: null, text: null, role: null, layout: null, gap: null, paddingX: null, paddingY: null,
    align: null, crossAlign: null, wrap: null, x: null, y: null, width: null, height: null, widthMode: null, heightMode: null, fill: null, stroke: null,
    strokeWidth: null, radius: null, shadow: null, opacity: null, fontSize: null, fontWeight: null, fontFamily: null, textColor: null, textAlign: null, icon: null,
    ...a,
  }) as AiAction;

function projectWithFrame() {
  const p = createProject('AI');
  const f = createFrame({ parentId: p.pages[0]!.id, width: 1440, height: 900, name: 'Login' });
  return { p: produce(p, (d) => applyOps(d, [op.insert([f])])), frame: f };
}

const dashboardPlan = {
  summary: 'Dashboard creata',
  actions: [
    act({ ref: 'screen', kind: 'frame', name: 'Dashboard', layout: 'vertical', width: 1440, gap: 24, paddingX: 32, paddingY: 32, fill: '#F7F7FA' }),
    act({ ref: 'title', parent: 'screen', kind: 'text', text: 'Panoramica', fontSize: 32, fontWeight: 700, role: 'h1', textColor: '#111' }),
    act({ ref: 'cards', parent: 'screen', kind: 'frame', layout: 'horizontal', gap: 16 }),
    act({ parent: 'cards', kind: 'frame', name: 'KPI', layout: 'vertical', fill: '#FFFFFF', radius: 12, paddingX: 16, paddingY: 16, role: 'article' }),
    act({ parent: 'ghost', kind: 'text', text: 'orphan' }),
    act({ action: 'update', id: 'missing-id', name: 'x' }),
  ],
};

describe('AI plan', () => {
  it('converts a valid plan into ops and reports invalid actions', () => {
    const { p } = projectWithFrame();
    const res = planToOps(p, parsePlan(dashboardPlan), p.pages[0]!.id, () => createId());
    expect(res.errors).toHaveLength(2);
    expect(res.createdRoots).toHaveLength(1);
    const next = produce(p, (d) => applyOps(d, res.ops));
    expect(checkIntegrity(next)).toEqual([]);
    const screen = next.nodes[res.createdRoots[0]!]!;
    expect(screen).toMatchObject({ type: 'frame', name: 'Dashboard', x: 1600 });
    const kpi = Object.values(next.nodes).find((n) => n.name === 'KPI')!;
    expect(kpi).toMatchObject({ layoutPositioning: 'auto', role: 'article' });
    const title = Object.values(next.nodes).find((n) => n.type === 'text' && n.characters === 'Panoramica')!;
    expect(title.fills[0]).toMatchObject({ color: '#111111' });
  });

  it('updates and deletes existing layers and rejects bad values', () => {
    const { p, frame } = projectWithFrame();
    const res = planToOps(
      p,
      parsePlan({ summary: 's', actions: [act({ action: 'update', id: frame.id, fill: '#0B5FFF', layout: 'vertical' }), act({ action: 'update', id: frame.id, fill: 'blue' }), act({ action: 'delete', id: frame.id })] }),
      p.pages[0]!.id,
      () => createId(),
    );
    expect(res.errors[0]).toMatch(/invalid color/);
    expect(res.updatedIds).toEqual([]);
    expect(res.deletedIds).toEqual([frame.id]);
  });

  it('accepts provider output with omitted null fields and fenced JSON, rejects garbage', () => {
    const plan = parsePlan('```json\n{"summary":"ok","actions":[{"action":"create","kind":"text","text":"Ciao"}]}\n```');
    expect(plan.actions[0]).toMatchObject({ kind: 'text', text: 'Ciao', ref: null });
    expect(() => parsePlan('{"summary": 1}')).toThrow(/Invalid AI plan/);
    expect(() => parsePlan({ summary: 'x', actions: [{ action: 'eval', code: 'alert(1)' }] })).toThrow();
  });

  it('JSON schema is non-recursive and requires every field (structured outputs constraints)', () => {
    const s = JSON.stringify(AI_PLAN_JSON_SCHEMA);
    expect(s).not.toContain('$ref');
    const item = (AI_PLAN_JSON_SCHEMA.properties as Record<string, { items: { required: string[]; properties: object } }>).actions!.items;
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
  });
});

describe('design agent', () => {
  it('builds context, calls the provider and returns validated ops without applying them', async () => {
    const { p, frame } = projectWithFrame();
    const calls: GenerateRequest[] = [];
    const provider: AiProvider = {
      id: 'ollama',
      label: 'fake',
      billable: false,
      check: async () => ({ ok: true, message: '' }),
      generate: async (req) => {
        calls.push(req);
        return { text: '', json: dashboardPlan, model: 'fake', usage: { inputTokens: 10, outputTokens: 20 } };
      },
    };
    const out = await runDesignAgent(provider, p, { targetId: p.pages[0]!.id, contextIds: [frame.id] }, 'Crea una dashboard');
    expect(calls[0]!.prompt).toContain(`id=${frame.id}`);
    expect(calls[0]!.prompt).toContain('Crea una dashboard');
    expect(calls[0]!.schema).toBe(AI_PLAN_JSON_SCHEMA);
    expect(out.result.ops.length).toBeGreaterThan(0);
    expect(p.pages[0]!.childIds).toEqual([frame.id]); // nothing applied
  });
});

describe('providers', () => {
  it('Ollama: lists models and sends structured requests', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'llama3.2' }] }));
      const body = JSON.parse(String(init!.body));
      expect(body.format).toEqual({ type: 'object' });
      expect(body.stream).toBe(false);
      return new Response(JSON.stringify({ model: 'llama3.2', message: { content: '{"a":1}' }, prompt_eval_count: 5, eval_count: 7 }));
    });
    const p = createOllamaProvider({ baseUrl: 'http://localhost:11434/', model: 'llama3.2' }, fetchFn as unknown as typeof fetch);
    expect((await p.check()).ok).toBe(true);
    const r = await p.generate({ system: 's', prompt: 'p', schema: { type: 'object' } });
    expect(r).toMatchObject({ json: { a: 1 }, usage: { inputTokens: 5, outputTokens: 7 } });
    expect(p.billable).toBe(false);
  });

  it('Ollama: reports connection problems clearly', async () => {
    const p = createOllamaProvider({ baseUrl: 'http://localhost:1', model: 'x' }, (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    await expect(p.check()).rejects.toThrow(/non raggiungibile/);
  });

  it('Claude: sends the session token to the local proxy, never an API key', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init!.headers as Record<string, string>;
      expect(headers['x-flo-token']).toBe('tok');
      expect(JSON.stringify(init)).not.toMatch(/x-api-key|anthropic-version/);
      return new Response(JSON.stringify({ text: '{}', json: { ok: 1 }, model: 'claude-opus-5-5', usage: { inputTokens: 1, outputTokens: 2 }, refusal: null }));
    });
    const p = createClaudeProvider({ proxyUrl: 'http://127.0.0.1:8787', token: 'tok', model: 'claude-opus-5-5' }, fetchFn as unknown as typeof fetch);
    expect(p.billable).toBe(true);
    expect((await p.generate({ system: 's', prompt: 'p', schema: {} })).json).toEqual({ ok: 1 });
  });

  it('Claude: surfaces refusals and auth errors', async () => {
    const refusing = createClaudeProvider({ proxyUrl: 'http://x', token: 't', model: 'm' }, (async () =>
      new Response(JSON.stringify({ text: '', model: 'm', refusal: { category: 'cyber' } }))) as unknown as typeof fetch);
    await expect(refusing.generate({ system: '', prompt: 'x' })).rejects.toThrow(/rifiutato/);
    const unauth = createClaudeProvider({ proxyUrl: 'http://x', token: 't', model: 'm' }, (async () =>
      new Response(JSON.stringify({ kind: 'token', error: 'Missing or wrong flö proxy token' }), { status: 401 })) as unknown as typeof fetch);
    await expect(unauth.check()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('workflow AI nodes', () => {
  it('run with a provider, create editable frames, and stay unavailable without one', async () => {
    const { runWorkflow } = await import('../workflow/engine');
    const { getSpec } = await import('../workflow/catalog');
    const node = (kind: string, params: Record<string, unknown> = {}) => ({ id: createId(), kind, label: kind, position: { x: 0, y: 0 }, params: { ...getSpec(kind)!.defaults, ...params } });
    const brief = node('brief-input', { text: 'App per prenotare la manutenzione auto' });
    const ia = node('info-architecture');
    const ui = node('ui-generator');
    const wf = {
      id: createId(),
      name: 'AI',
      nodes: [brief, ia, ui],
      edges: [
        { id: createId(), source: brief.id, sourcePort: 'brief', target: ia.id, targetPort: 'brief' },
        { id: createId(), source: brief.id, sourcePort: 'brief', target: ui.id, targetPort: 'brief' },
      ],
    };
    let project: Project = produce(createProject('W'), (d) => applyOps(d, [{ type: 'createWorkflow', workflow: wf }]));
    const generate = vi.fn(async (req: GenerateRequest) => {
      if (req.system.includes('information architect')) return { text: '', json: { pages: [{ name: 'Home', depth: 0 }, { name: 'Prenota', depth: 0 }, { name: 'Officine', depth: 1 }] }, model: 'fake' };
      return { text: '', json: dashboardPlan, model: 'fake', usage: { inputTokens: 1, outputTokens: 1 } };
    });
    const host = {
      aiAvailable: true,
      lang: 'it' as const,
      ai: { generate },
      getProject: () => project,
      apply: (ops: Parameters<typeof applyOps>[1]) => (project = produce(project, (d) => applyOps(d, ops))),
    };
    const res = await runWorkflow(project.workflows[0]!, new Map(), host);
    expect(res.errors).toEqual({});
    const aiPage = project.pages.find((p) => p.name === 'AI')!;
    expect(aiPage.childIds).toHaveLength(1);
    expect(checkIntegrity(project)).toEqual([]);

    const none = await runWorkflow(project.workflows[0]!, new Map(), { ...host, aiAvailable: false, ai: undefined });
    expect(none.statuses[ui.id]).toBe('unavailable');
  });
});

describe('AI plan sizing defaults', () => {
  it('fills width in vertical stacks and hugs in rows', () => {
    const { p } = projectWithFrame();
    const res = planToOps(
      p,
      parsePlan({
        summary: '',
        actions: [
          act({ ref: 's', kind: 'frame', layout: 'vertical', width: 800 }),
          act({ ref: 'row', parent: 's', kind: 'frame', layout: 'horizontal' }),
          act({ ref: 'btn', parent: 'row', kind: 'frame', layout: 'horizontal', name: 'Btn' }),
        ],
      }),
      p.pages[0]!.id,
      () => createId(),
    );
    const next = produce(p, (d) => applyOps(d, res.ops));
    const row = Object.values(next.nodes).find((n) => n.type === 'frame' && n.layout.mode === 'horizontal' && n.name !== 'Btn')!;
    const btn = Object.values(next.nodes).find((n) => n.name === 'Btn')!;
    expect(row.sizing.horizontal).toBe('fill');
    expect(btn.sizing).toEqual({ horizontal: 'hug', vertical: 'hug' });
  });
});
