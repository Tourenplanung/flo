import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { cloneSubtree } from '../clone';
import { createFrame, createProject, createRect, createText } from '../factory';
import { applyOps, op, type DocOp } from '../ops';
import { applyAction, resolveTarget, revertHover, startState, type ActionContext } from '../prototype';
import type { Interaction, Project } from '../schema';
import { checkIntegrity, parseProject } from '../validate';

const apply = (p: Project, ops: DocOp[]) => produce(p, (d) => applyOps(d, ops));
const nav = (id: string, destinationId: string): Interaction => ({ id, trigger: 'click', action: { type: 'navigate', destinationId, transition: { type: 'slide-left', durationMs: 250 } } });

function setup() {
  const p = createProject('Proto');
  const page = p.pages[0]!;
  const home = createFrame({ parentId: page.id, width: 390, height: 844, name: 'Home' });
  const detail = createFrame({ parentId: page.id, x: 500, width: 390, height: 844, name: 'Dettaglio' });
  const menu = createFrame({ parentId: page.id, x: 1000, width: 300, height: 400, name: 'Menu' });
  const btn = createRect({ parentId: home.id, name: 'CTA' });
  const tip = createText({ parentId: home.id, name: 'Tooltip' }, { characters: 'Ciao', visible: false });
  const q = apply(p, [op.insert([home]), op.insert([detail]), op.insert([menu]), op.insert([btn]), op.insert([tip])]);
  return { q, page, home, detail, menu, btn, tip };
}

const ctxFor = (project: Project, sourceId: string): ActionContext => ({
  project,
  sourceId,
  exists: (id) => !!project.nodes[id],
  baseVisible: (id) => project.nodes[id]?.visible ?? true,
});

describe('interaction ops', () => {
  it('validates destinations and targets', () => {
    const { q, btn, detail, home } = setup();
    const ok = apply(q, [{ type: 'setInteractions', id: btn.id, interactions: [nav('i1', detail.id)] }]);
    expect(ok.nodes[btn.id]!.interactions).toHaveLength(1);
    expect(() => apply(q, [{ type: 'setInteractions', id: btn.id, interactions: [nav('i1', btn.id)] }])).toThrow(/top-level frame/);
    expect(() => apply(q, [{ type: 'setInteractions', id: home.id, interactions: [nav('i1', home.id)] }])).toThrow(/itself/);
    expect(() => apply(q, [{ type: 'setInteractions', id: btn.id, interactions: [{ id: 'x', trigger: 'click', action: { type: 'toggle-visibility', targetId: 'missing' } }] }])).toThrow(/not found/);
    expect(() => apply(q, [{ type: 'setPrototypeStart', frameId: btn.id }])).toThrow();
    expect(apply(q, [{ type: 'setPrototypeStart', frameId: home.id }]).prototype.startFrameId).toBe(home.id);
  });

  it('prunes interactions and the start screen when targets are deleted', () => {
    const { q, btn, detail } = setup();
    let r = apply(q, [{ type: 'setInteractions', id: btn.id, interactions: [nav('i1', detail.id)] }, { type: 'setPrototypeStart', frameId: detail.id }]);
    r = apply(r, [op.remove(detail.id)]);
    expect(r.nodes[btn.id]!.interactions).toEqual([]);
    expect(r.prototype.startFrameId).toBeNull();
    expect(checkIntegrity(r)).toEqual([]);
    expect(parseProject(JSON.parse(JSON.stringify(r))).schemaVersion).toBe(4);
  });

  it('remaps internal toggle targets when a screen is duplicated', () => {
    const { q, home, btn, tip, page } = setup();
    const r = apply(q, [{ type: 'setInteractions', id: btn.id, interactions: [{ id: 't', trigger: 'hover', action: { type: 'toggle-visibility', targetId: tip.id } }] }]);
    const clones = cloneSubtree(r.nodes, home.id, page.id);
    const btnCopy = clones.find((n) => n.name === 'CTA')!;
    const tipCopy = clones.find((n) => n.name === 'Tooltip')!;
    expect(btnCopy.interactions[0]!.action).toMatchObject({ targetId: tipCopy.id });
  });
});

describe('prototype player', () => {
  it('starts on the start screen, navigates with history and goes back', () => {
    const { q, home, detail } = setup();
    let s = startState(q)!;
    expect(s.screenId).toBe(home.id);
    s = applyAction(s, nav('n', detail.id).action, ctxFor(q, 'x'));
    expect(s).toMatchObject({ screenId: detail.id, history: [home.id], direction: 'forward', transition: { type: 'slide-left' } });
    s = applyAction(s, { type: 'back' }, ctxFor(q, 'x'));
    expect(s).toMatchObject({ screenId: home.id, history: [], direction: 'back' });
    expect(startState(apply(q, [{ type: 'setPrototypeStart', frameId: detail.id }]))!.screenId).toBe(detail.id);
  });

  it('opens and closes overlays; back closes the overlay first', () => {
    const { q, menu, detail } = setup();
    let s = startState(q)!;
    s = applyAction(s, { type: 'open-overlay', destinationId: menu.id, position: 'right', closeOnOutsideClick: true, dimBackground: true }, ctxFor(q, 'x'));
    expect(s.overlays.map((o) => o.frameId)).toEqual([menu.id]);
    s = applyAction(s, nav('n', detail.id).action, ctxFor(q, 'x'));
    expect(s.overlays).toEqual([]);
    s = applyAction(s, { type: 'open-overlay', destinationId: menu.id, position: 'center', closeOnOutsideClick: false, dimBackground: false }, ctxFor(q, 'x'));
    s = applyAction(s, { type: 'back' }, ctxFor(q, 'x'));
    expect(s.overlays).toEqual([]);
    expect(s.screenId).toBe(detail.id);
  });

  it('toggles visibility and reverts hover actions', () => {
    const { q, tip, btn } = setup();
    const ctx = ctxFor(q, btn.id);
    const action = { type: 'toggle-visibility' as const, targetId: tip.id };
    let s = applyAction(startState(q)!, action, ctx);
    expect(s.visibility[tip.id]).toBe(true);
    s = revertHover(s, action, ctx);
    expect(s.visibility[tip.id]).toBe(false);
  });

  it('scopes targets inside instances', () => {
    const exists = (id: string) => ['inst__tip', 'tip'].includes(id);
    expect(resolveTarget('inst__btn', 'tip', exists)).toBe('inst__tip');
    expect(resolveTarget('btn', 'tip', exists)).toBe('tip');
  });
});
