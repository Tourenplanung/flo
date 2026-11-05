import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createFrame, createPage, createPreset, createProject, createRect, createText } from '../factory';
import { applyOps, op, OpError, parseOps, type DocOp } from '../ops';
import type { Project } from '../schema';
import { checkIntegrity } from '../validate';

function apply(p: Project, ops: DocOp[]) {
  return produce(p, (d) => applyOps(d, ops));
}

function setup() {
  const p = createProject('Test');
  const page = p.pages[0]!;
  const frame = createFrame({ parentId: page.id, width: 1440, height: 900, name: 'Desktop' });
  const rect = createRect({ parentId: frame.id, x: 10, y: 20 });
  frame.childIds = [];
  const p2 = apply(p, [op.insert([frame]), op.insert([rect])]);
  return { p: p2, page, frame, rect };
}

describe('document operations', () => {
  it('inserts nodes and keeps integrity', () => {
    const { p, page, frame, rect } = setup();
    expect(p.pages[0]!.childIds).toEqual([frame.id]);
    expect(p.nodes[frame.id]!.childIds).toEqual([rect.id]);
    expect(p.nodes[rect.id]!.parentId).toBe(frame.id);
    expect(checkIntegrity(p)).toEqual([]);
    expect(page.id).toBeTruthy();
  });

  it('inserts composite presets as editable trees', () => {
    const { p, frame } = setup();
    const tree = createPreset('section', frame.id, 0, 0);
    const next = apply(p, [op.insert(tree.nodes)]);
    expect(checkIntegrity(next)).toEqual([]);
    const root = next.nodes[tree.root.id]!;
    expect(root.type).toBe('frame');
    expect(root.childIds.length).toBe(3);
  });

  it('updates validated properties only', () => {
    const { p, rect } = setup();
    const next = apply(p, [op.update(rect.id, { width: 300, fills: [{ type: 'solid', color: '#FF0000', opacity: 1, visible: true }] })]);
    expect(next.nodes[rect.id]!.width).toBe(300);
    expect(() => apply(p, [op.update(rect.id, { width: -5 })])).toThrow(OpError);
    expect(() => apply(p, [op.update(rect.id, { fills: [{ type: 'solid', color: 'red', opacity: 1, visible: true }] } as never)])).toThrow(OpError);
    expect(() => apply(p, [{ type: 'updateNode', id: rect.id, props: { parentId: 'x' } }])).toThrow(/cannot be updated/);
    expect(() => apply(p, [{ type: 'updateNode', id: rect.id, props: { type: 'text' } }])).toThrow(/cannot be updated/);
  });

  it('rejects children under leaf nodes', () => {
    const { p, rect } = setup();
    const child = createRect({ parentId: rect.id });
    expect(() => apply(p, [op.insert([child])])).toThrow(/cannot contain children/);
  });

  it('prevents cycles when moving', () => {
    const { p, frame } = setup();
    const inner = createFrame({ parentId: frame.id });
    const p2 = apply(p, [op.insert([inner])]);
    expect(() => apply(p2, [op.move(frame.id, inner.id)])).toThrow(/inside itself/);
    expect(() => apply(p2, [op.move(frame.id, frame.id)])).toThrow(/inside itself/);
  });

  it('moves and reorders between parents', () => {
    const { p, page, frame, rect } = setup();
    const r2 = createRect({ parentId: frame.id });
    let next = apply(p, [op.insert([r2])]);
    next = apply(next, [op.move(r2.id, frame.id, 0)]);
    expect(next.nodes[frame.id]!.childIds).toEqual([r2.id, rect.id]);
    next = apply(next, [op.move(rect.id, page.id)]);
    expect(next.pages[0]!.childIds).toEqual([frame.id, rect.id]);
    expect(next.nodes[rect.id]!.parentId).toBe(page.id);
    expect(checkIntegrity(next)).toEqual([]);
  });

  it('deletes whole subtrees', () => {
    const { p, frame, rect } = setup();
    const next = apply(p, [op.remove(frame.id)]);
    expect(next.nodes[frame.id]).toBeUndefined();
    expect(next.nodes[rect.id]).toBeUndefined();
    expect(next.pages[0]!.childIds).toEqual([]);
  });

  it('manages pages and refuses to delete the last one', () => {
    const { p } = setup();
    const page2 = createPage('Two');
    const next = apply(p, [{ type: 'createPage', page: page2 }]);
    expect(next.pages.length).toBe(2);
    const after = apply(next, [{ type: 'deletePage', id: p.pages[0]!.id }]);
    expect(after.pages.map((x) => x.id)).toEqual([page2.id]);
    expect(Object.keys(after.nodes)).toEqual([]);
    expect(() => apply(after, [{ type: 'deletePage', id: page2.id }])).toThrow(/at least one page/);
  });

  it('rejects duplicate ids and broken trees', () => {
    const { p, frame, rect } = setup();
    expect(() => apply(p, [op.insert([{ ...rect }])])).toThrow(/Duplicate/);
    const t = createText({ parentId: frame.id });
    const orphan = createRect({ parentId: 'elsewhere' });
    expect(() => apply(p, [op.insert([t, orphan])])).toThrow();
  });

  it('parses untrusted op payloads', () => {
    expect(() => parseOps([{ type: 'deleteNode', id: '../../etc' }])).toThrow(OpError);
    expect(() => parseOps([{ type: 'evalCode', code: 'alert(1)' }])).toThrow(OpError);
    expect(parseOps([{ type: 'renameProject', name: 'ok' }])).toHaveLength(1);
  });
});
