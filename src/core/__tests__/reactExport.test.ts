import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createFrame, createIcon, createImage, createInstance, createProject, createText, solid } from '../factory';
import { exportReactProject, zipExport } from '../export/react';
import { applyOps, op, type DocOp } from '../ops';
import type { FrameNode, Project } from '../schema';

const apply = (p: Project, ops: DocOp[]) => produce(p, (d) => applyOps(d, ops));
const vertical = { mode: 'vertical' as const, gap: 16, padding: [24, 24, 24, 24] as [number, number, number, number], primaryAlign: 'start' as const, counterAlign: 'start' as const, wrap: false };

function sample() {
  let p = createProject('Concierge Auto');
  const page = p.pages[0]!;
  const home = createFrame({ parentId: page.id, width: 1440, height: 900, name: 'Home' }, { layout: vertical, role: 'main' });
  const detail = createFrame({ parentId: page.id, x: 1600, width: 1440, height: 900, name: 'Dettaglio' }, { layout: vertical });
  const menu = createFrame({ parentId: page.id, x: 3200, width: 320, height: 400, name: 'Menu' });
  const h1 = createText({ parentId: home.id }, { characters: 'Benvenuto <script>', role: 'h1', fontSize: 48, layoutPositioning: 'auto' });
  const tip = createText({ parentId: home.id, name: 'Suggerimento' }, { characters: 'Suggerimento', visible: false, layoutPositioning: 'auto' });
  const hero = createImage({ parentId: home.id, width: 400, height: 200, name: 'Hero image' }, { alt: 'Auto', layoutPositioning: 'auto' });
  const icon = createIcon({ parentId: home.id }, 'home', { layoutPositioning: 'auto' });
  // Component: card with title + body
  const card = createFrame({ parentId: page.id, y: 1200, width: 320, height: 200, name: 'Service card' }, { layout: vertical, fills: [solid('#FFFFFF')] });
  const title = createText({ parentId: card.id, name: 'Title' }, { characters: 'Servizio', layoutPositioning: 'auto' });
  const body = createText({ parentId: card.id, name: 'Body' }, { characters: 'Descrizione', layoutPositioning: 'auto' });
  card.childIds = [title.id, body.id];
  p = apply(p, [
    op.insert([home]), op.insert([detail]), op.insert([menu]), op.insert([h1]), op.insert([tip]), op.insert([hero]), op.insert([icon]),
    op.insert([card, title, body]),
    { type: 'setComponent', id: card.id, component: { set: 'Card', variant: {}, description: '' } },
    { type: 'upsertToken', token: { kind: 'colors', value: { id: 'brand', name: 'Brand', value: '#0B5FFF', opacity: 1 } } },
    op.update(h1.id, { bindings: { fill: 'brand' } }),
    { type: 'setResponsive', id: h1.id, breakpointId: 'bp-mobile', props: { fontSize: 28 } },
  ]);
  const inst = { ...createInstance({ parentId: home.id }, p.nodes[card.id] as FrameNode), layoutPositioning: 'auto' as const };
  p = apply(p, [
    op.insert([inst]),
    { type: 'setInstanceOverride', id: inst.id, sourceId: title.id, props: { characters: 'Ritiro a domicilio', fontWeight: 800 } },
    { type: 'setInteractions', id: inst.id, interactions: [{ id: 'i1', trigger: 'click', action: { type: 'navigate', destinationId: detail.id, transition: { type: 'slide-left', durationMs: 250 } } }] },
    { type: 'setInteractions', id: h1.id, interactions: [{ id: 'i2', trigger: 'hover', action: { type: 'toggle-visibility', targetId: tip.id } }, { id: 'i3', trigger: 'click', action: { type: 'open-overlay', destinationId: menu.id, position: 'right', closeOnOutsideClick: true, dimBackground: true } }] },
    { type: 'setPrototypeStart', frameId: home.id },
  ]);
  return { p, home, detail, menu, card };
}

describe('React export', () => {
  it('generates a structured, typed project that compiles in strict mode', async () => {
    const { p, home, detail, menu } = sample();
    const res = await exportReactProject(p, [home.id, detail.id, menu.id], { name: 'Concierge Auto', lang: 'it' }, { getAssetBytes: async () => new Uint8Array([1, 2, 3]) });
    const byPath = new Map(res.files.map((f) => [f.path, f.content]));
    expect([...byPath.keys()]).toEqual(
      expect.arrayContaining(['package.json', 'index.html', 'src/App.tsx', 'src/prototype.tsx', 'src/screens/Home.tsx', 'src/screens/Home.css', 'src/components/ServiceCard.tsx', 'src/styles/tokens.css', 'ACCESSIBILITY.md', 'README.md']),
    );
    const homeTsx = String(byPath.get('src/screens/Home.tsx'));
    expect(homeTsx).toContain('<h1 ');
    expect(homeTsx).toContain('"Benvenuto <script>"'); // text is a JS string literal, never HTML
    expect(homeTsx).toContain('<ServiceCard ');
    expect(homeTsx).toContain('texts={{"title":"Ritiro a domicilio"}}');
    expect(homeTsx).toMatch(/proto\.run\(\[\{"type":"navigate","to":"Dettaglio"/);
    expect(homeTsx).toContain('role="button"');
    expect(homeTsx).toContain('<IconHome ');
    const homeCss = String(byPath.get('src/screens/Home.css'));
    expect(homeCss).toContain('var(--color-brand)');
    expect(homeCss).toMatch(/@media \(max-width: 640px\)/);
    expect(homeCss).not.toMatch(/position: absolute;\s*left: 0px;\s*top: 0px;[\s\S]*margin: 0 auto/);
    expect(String(byPath.get('src/App.tsx'))).toContain('start="Home"');
    expect(String(byPath.get('src/components/ServiceCard.tsx'))).toContain('props.texts?.title ?? "Servizio"');
    expect(JSON.parse(String(byPath.get('package.json'))).dependencies['lucide-react']).toBe('0.544.0');
    expect(res.screens).toEqual(['Home', 'Dettaglio', 'Menu']);

    // Type-check the generated sources with the repository's TypeScript and type packages.
    const dir = join(process.cwd(), '.tmp-export', 'unit');
    rmSync(dir, { recursive: true, force: true });
    for (const f of res.files) {
      const target = join(dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.content);
    }
    let out = '';
    try {
      execFileSync(join(process.cwd(), 'node_modules/.bin/tsc'), ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
    } catch (e) {
      out = (e as { stdout?: string }).stdout ?? String(e);
    }
    expect(out).toBe('');

    const zip = await zipExport(res.files, 'concierge-auto');
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  }, 60_000);

  it('warns about interactions to screens that are not exported', async () => {
    const { p, home } = sample();
    const res = await exportReactProject(p, [home.id], { name: 'x', lang: 'en' });
    expect(res.warnings.join(' ')).toMatch(/not exported/);
  });
});
