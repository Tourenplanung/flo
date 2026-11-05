import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createFrame, createProject, createText } from '../factory';
import { parseBundle, serializeBundle, withNewIdentity } from '../fileFormat';
import { migrateProject } from '../migrate';
import { applyOps, op } from '../ops';
import { parseProject } from '../validate';

function sample() {
  const p = createProject('Landing');
  const frame = createFrame({ parentId: p.pages[0]!.id, width: 1440, height: 900 });
  const text = createText({ parentId: frame.id }, { characters: '<script>alert(1)</script>' });
  return produce(p, (d) => applyOps(d, [op.insert([frame]), op.insert([text])]));
}

describe('project validation & migration', () => {
  it('round-trips a valid project', () => {
    const p = sample();
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects structural corruption', () => {
    const p = JSON.parse(JSON.stringify(sample()));
    const frameId = p.pages[0].childIds[0];
    p.nodes[frameId].parentId = frameId; // self-parent
    expect(() => parseProject(p)).toThrow();
    const q = JSON.parse(JSON.stringify(sample()));
    q.pages[0].childIds.push('missingNode');
    expect(() => parseProject(q)).toThrow(/missing child/);
  });

  it('rejects unsafe values that would reach CSS', () => {
    const p = JSON.parse(JSON.stringify(sample()));
    const textId = Object.keys(p.nodes).find((id) => p.nodes[id].type === 'text');
    p.nodes[textId!].fontFamily = "x'; background:url(javascript:alert(1))";
    expect(() => parseProject(p)).toThrow();
  });

  it('migrates v0 drafts to the current schema', () => {
    const p = JSON.parse(JSON.stringify(sample()));
    delete p.assets;
    delete p.pages[0].guides;
    delete p.pages[0].background;
    delete p.workflows;
    delete p.tokens;
    delete p.breakpoints;
    for (const n of Object.values(p.nodes) as Record<string, unknown>[]) {
      delete n.constraints;
      delete n.bindings;
      delete n.responsive;
      delete n.component;
    }
    p.schemaVersion = 0;
    const migrated = migrateProject(p);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.breakpoints.length).toBe(2);
    expect(Object.values(migrated.nodes).every((n) => n.constraints && n.responsive)).toBe(true);
    expect(migrated.workflows).toEqual([]);
    expect(migrated.pages[0]!.guides).toEqual([]);
  });

  it('refuses documents from the future', () => {
    const p = { ...JSON.parse(JSON.stringify(sample())), schemaVersion: 99 };
    expect(() => migrateProject(p)).toThrow(/newer version/);
  });
});

describe('file bundle', () => {
  it('serializes and parses bundles, keeping text as data', () => {
    const p = sample();
    const text = serializeBundle({ project: p, assets: {} });
    const back = parseBundle(text);
    expect(back.project).toEqual(p);
    const imported = withNewIdentity(back.project);
    expect(imported.id).not.toBe(p.id);
  });

  it('rejects non-flö and malformed files', () => {
    expect(() => parseBundle('not json')).toThrow(/valid JSON/);
    expect(() => parseBundle(JSON.stringify({ hello: 'world' }))).toThrow(/Not a flö/);
  });

  it('rejects asset payloads that are not allowed images', () => {
    const p = produce(sample(), (d) => {
      d.assets.a1 = { id: 'a1', name: 'x', mimeType: 'image/png', width: 1, height: 1, size: 10 };
    });
    const bad = serializeBundle({ project: p, assets: { a1: 'data:text/html;base64,PHNjcmlwdD4=' } });
    expect(() => parseBundle(bad)).toThrow(/invalid or mismatched/);
    const svg = serializeBundle({ project: p, assets: { a1: 'data:image/svg+xml;base64,PHN2Zz4=' } });
    expect(() => parseBundle(svg)).toThrow();
    const ok = serializeBundle({ project: p, assets: { a1: 'data:image/png;base64,iVBORw0KGgo=' } });
    expect(parseBundle(ok).assets.a1).toBeDefined();
  });
});
