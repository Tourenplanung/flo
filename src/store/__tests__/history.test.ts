import { beforeEach, describe, expect, it } from 'vitest';
import { createFrame, createProject, createRect } from '@/core/factory';
import { op } from '@/core/ops';
import { useDocStore } from '../docStore';
import { useEditorStore } from '../editorStore';

describe('document store history', () => {
  beforeEach(() => {
    const p = createProject('H');
    useDocStore.getState().load(p);
    useEditorStore.getState().reset(p.pages[0]!.id);
  });

  it('undoes and redoes transactions', () => {
    const s = useDocStore.getState();
    const pageId = s.project!.pages[0]!.id;
    const frame = createFrame({ parentId: pageId });
    expect(s.dispatch([op.insert([frame])]).ok).toBe(true);
    expect(useDocStore.getState().project!.nodes[frame.id]).toBeDefined();
    useDocStore.getState().undo();
    expect(useDocStore.getState().project!.nodes[frame.id]).toBeUndefined();
    useDocStore.getState().redo();
    expect(useDocStore.getState().project!.nodes[frame.id]).toBeDefined();
  });

  it('merges gestures sharing a mergeKey into one undo step', () => {
    const pageId = useDocStore.getState().project!.pages[0]!.id;
    const rect = createRect({ parentId: pageId, x: 0 });
    useDocStore.getState().dispatch([op.insert([rect])]);
    for (let i = 1; i <= 10; i++) useDocStore.getState().dispatch([op.update(rect.id, { x: i * 10 })], { mergeKey: 'drag-1', mergeWindow: Infinity });
    expect(useDocStore.getState().past.length).toBe(2);
    useDocStore.getState().undo();
    expect(useDocStore.getState().project!.nodes[rect.id]!.x).toBe(0);
  });

  it('rejects invalid operations atomically', () => {
    const pageId = useDocStore.getState().project!.pages[0]!.id;
    const rect = createRect({ parentId: pageId });
    const before = useDocStore.getState().project;
    const res = useDocStore.getState().dispatch([op.insert([rect]), op.update(rect.id, { width: -1 })]);
    expect(res.ok).toBe(false);
    expect(useDocStore.getState().project).toBe(before);
    expect(useDocStore.getState().past.length).toBe(0);
  });

  it('clears redo stack on new changes', () => {
    const pageId = useDocStore.getState().project!.pages[0]!.id;
    useDocStore.getState().dispatch([op.insert([createRect({ parentId: pageId })])]);
    useDocStore.getState().undo();
    expect(useDocStore.getState().future.length).toBe(1);
    useDocStore.getState().dispatch([op.insert([createRect({ parentId: pageId })])]);
    expect(useDocStore.getState().future.length).toBe(0);
  });
});
