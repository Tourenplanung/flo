import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createFrame } from '@/core/factory';
import { applyOps, op } from '@/core/ops';
import { FloDB } from '../db';
import { createRepo } from '../projectRepo';

let n = 0;
const freshRepo = () => createRepo(new FloDB(`flo-test-${++n}`));

describe('project repository (IndexedDB)', () => {
  it('creates, saves, reloads and lists projects', async () => {
    const repo = freshRepo();
    const p = await repo.create('Alpha', 'Pagina 1');
    const frame = createFrame({ parentId: p.pages[0]!.id, name: 'Desktop' });
    const edited = produce(p, (d) => applyOps(d, [op.insert([frame])]));
    await repo.save(edited);
    const loaded = await repo.load(p.id);
    expect(loaded?.nodes[frame.id]?.name).toBe('Desktop');
    expect((await repo.list()).map((x) => x.name)).toEqual(['Alpha']);
  });

  it('renames, duplicates and deletes', async () => {
    const repo = freshRepo();
    const p = await repo.create('Beta');
    await repo.rename(p.id, 'Gamma');
    const copy = await repo.duplicate(p.id, '(copia)');
    expect(copy?.name).toBe('Gamma (copia)');
    expect((await repo.list()).length).toBe(2);
    await repo.remove(p.id);
    expect((await repo.list()).map((x) => x.id)).toEqual([copy!.id]);
  });

  it('exports and re-imports bundles under a new id', async () => {
    const repo = freshRepo();
    const p = await repo.create('Delta');
    const text = await repo.exportBundle(p.id);
    const imported = await repo.importBundle(text);
    expect(imported.id).not.toBe(p.id);
    expect(imported.name).toBe('Delta');
    expect((await repo.list()).length).toBe(2);
  });

  it('refuses to load tampered stored documents', async () => {
    const db = new FloDB(`flo-test-${++n}`);
    const repo = createRepo(db);
    const p = await repo.create('Evil');
    await db.projects.update(p.id, { doc: { ...p, nodes: { x: { type: 'script' } } } });
    await expect(repo.load(p.id)).rejects.toThrow();
  });
});
