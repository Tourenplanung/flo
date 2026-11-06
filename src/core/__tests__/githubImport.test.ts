import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { applyOps } from '../ops';
import { createProject } from '../factory';
import { GithubClient, filesUnder, localImports, parseGithubUrl, resolveImport } from '../importers/github';
import { ReactImporter, type SourceFile } from '../importers/reactImport';
import { parseClasses } from '../importers/tailwind';
import { ProjectSchema, type DesignNode, type FrameNode, type TextNode } from '../schema';
import { produce } from 'immer';

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8');
const SOURCES: SourceFile[] = [
  { path: 'components/ui/button.tsx', code: fx('button.tsx') },
  { path: 'components/hero.tsx', code: fx('hero.tsx') },
];

function convert(files: SourceFile[], name: string) {
  const imp = new ReactImporter(files);
  const info = imp.components().find((c) => c.name === name)!;
  return { imp, out: imp.convert(info, 'page') };
}
const byName = (nodes: DesignNode[], name: string) => nodes.filter((n) => n.name === name);
const textOf = (nodes: DesignNode[], chars: string) => nodes.find((n) => n.type === 'text' && n.characters === chars) as TextNode | undefined;

describe('tailwind mapping', () => {
  it('maps utilities and splits mobile-first breakpoints', () => {
    const unknown = new Set<string>();
    const { mobile, desktop } = parseClasses('flex flex-col gap-4 p-6 md:flex-row md:gap-8 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 hidden md:flex foo-bar', unknown);
    expect(mobile).toMatchObject({ display: 'flex', direction: 'column', gap: 16, pt: 24, pl: 24, bg: '#4F46E5', color: '#FFFFFF', radius: 12, hidden: true });
    expect(desktop).toMatchObject({ direction: 'row', gap: 32, hidden: false });
    expect([...unknown]).toEqual(['foo-bar']);
  });
});

describe('React importer (static, never executes code)', () => {
  it('finds components and cva variants', () => {
    const imp = new ReactImporter(SOURCES);
    const comps = imp.components();
    expect(comps.map((c) => c.name).sort()).toEqual(['Button', 'FeatureCard', 'Hero']);
    const button = comps.find((c) => c.name === 'Button')!;
    expect(button.exported).toBe(true);
    expect(button.variantKey).toBe('variant');
    expect(button.variantValues).toEqual(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link']);
    expect(comps.find((c) => c.name === 'FeatureCard')!.exported).toBe(false);
  });

  it('converts a shadcn Button into one component per variant', () => {
    const { out } = convert(SOURCES, 'Button');
    expect(out).toHaveLength(6);
    const def = out[0]!.tree.root as FrameNode;
    expect(def.type).toBe('frame');
    expect(def.role).toBe('button');
    expect(def.layout).toMatchObject({ mode: 'horizontal', padding: [8, 16, 8, 16], primaryAlign: 'center', counterAlign: 'center' });
    expect(def.fills[0]).toMatchObject({ type: 'solid', color: '#171717' });
    expect(def.height).toBe(36);
    const label = out[0]!.tree.nodes[1] as TextNode;
    expect(label).toMatchObject({ type: 'text', characters: 'Button', fontSize: 14, fontWeight: 500 });
    expect(label.fills[0]).toMatchObject({ color: '#FAFAFA' });
    const outline = out.find((o) => o.variant.variant === 'outline')!.tree.root as FrameNode;
    expect(outline.stroke).toMatchObject({ width: 1, color: '#E5E5E5' });
  });

  it('converts a Tailwind page section with data, local components, icons and responsive classes', () => {
    const { imp, out } = convert(SOURCES, 'Hero');
    const nodes = out[0]!.tree.nodes;
    const root = out[0]!.tree.root as FrameNode;
    expect(root.role).toBe('section');
    expect(root.fills[0]).toMatchObject({ type: 'linear-gradient', angle: 180 });
    expect(root.layout.padding).toEqual([96, 48, 96, 48]);
    expect(root.responsive['bp-mobile']?.layout?.padding).toEqual([96, 24, 96, 24]);
    // Prop default + md:text-6xl → 60px desktop, 36px mobile override.
    const title = textOf(nodes, 'Costruisci più in fretta')!;
    expect(title).toMatchObject({ fontSize: 60, fontWeight: 700, role: 'h1', textAlign: 'center' });
    expect(title.responsive['bp-mobile']).toMatchObject({ fontSize: 36 });
    // Inline <strong> is flattened into the paragraph.
    expect(textOf(nodes, 'Un sottotitolo che spiega il valore del prodotto.')).toBeTruthy();
    // features.map over a constant array → three cards in a 3-column grid that stacks on mobile.
    for (const t of ['Veloce', 'Sicuro', 'Flessibile']) expect(textOf(nodes, t)).toBeTruthy();
    const row = byName(nodes, 'Row 1')[0] as FrameNode;
    expect(row.childIds).toHaveLength(3);
    expect(row.responsive['bp-mobile']?.layout?.mode).toBe('vertical');
    // Margins (mt-4 / mt-2) became the card's stack gap.
    const card = nodes.find((n) => n.id === row.childIds[0]) as FrameNode;
    expect(card.layout.gap).toBe(8);
    // The imported Button (resolved across files) keeps its variant styles.
    const buttons = byName(nodes, 'Button') as FrameNode[];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.layout.padding).toEqual([0, 32, 0, 32]);
    // Icons: lucide → flö icons; unknown icons fall back to "star" with a warning.
    const icons = nodes.filter((n) => n.type === 'icon');
    expect(icons.map((i) => (i.type === 'icon' ? i.icon : ''))).toEqual(expect.arrayContaining(['arrow-right', 'check', 'star']));
    expect(imp.report().warnings.join('\n')).toContain('Rocket');
    // `hidden md:flex` → visible on desktop, hidden on mobile.
    const nav = nodes.find((n) => n.type === 'frame' && n.role === 'nav')!;
    expect(nav.visible).toBe(true);
    expect(nav.responsive['bp-mobile']?.visible).toBe(false);
    const input = nodes.find((n) => n.name === 'Input') as FrameNode;
    expect(input.role).toBe('input');
    expect(textOf(nodes, 'Email')).toBeTruthy();
  });

  it('produces schema-valid layers that apply as ops', () => {
    const { out } = convert(SOURCES, 'Hero');
    const p = createProject('t');
    const pageId = p.pages[0]!.id;
    const nodes = out[0]!.tree.nodes.map((n) => (n.parentId === 'page' ? { ...n, parentId: pageId } : n));
    const next = produce(p, (d) => applyOps(d, [{ type: 'insertTree', nodes }]));
    expect(ProjectSchema.safeParse(next).success).toBe(true);
  });

  it('shows placeholders for unknown props and data instead of inventing content', () => {
    const { out } = convert(SOURCES, 'FeatureCard');
    const nodes = out[0]!.tree.nodes;
    expect(textOf(nodes, 'Title')).toBeTruthy();
    expect(textOf(nodes, 'Text')).toBeTruthy();
    const list = convert([{ path: 'List.tsx', code: 'export function List({ items }) { return <ul className="space-y-2">{items.map((item) => <li key={item.id} className="text-sm">{item.label}</li>)}</ul>; }' }], 'List').out;
    expect(textOf(list[0]!.tree.nodes, 'Label')).toBeTruthy();
  });

  it('never runs imported code', () => {
    const spy = vi.fn();
    (globalThis as Record<string, unknown>).__floPwned = spy;
    const code = `
      globalThis.__floPwned();
      const x = (() => { globalThis.__floPwned(); return 'bg-red-500'; })();
      export default function Evil() {
        fetch('https://evil.example');
        eval("globalThis.__floPwned()");
        return <div className={x} onClick={() => globalThis.__floPwned()} dangerouslySetInnerHTML={{ __html: '<img src=x onerror=alert(1)>' }}><script>{'alert(1)'}</script>Ciao</div>;
      }`;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { imp, out } = convert([{ path: 'Evil.tsx', code }], 'Evil');
    expect(spy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const all = JSON.stringify(out);
    expect(all).not.toContain('onerror');
    expect(all).not.toContain('alert(1)');
    expect(imp.report().warnings.join(' ')).toContain('dangerouslySetInnerHTML');
    fetchSpy.mockRestore();
  });

  it('survives syntax errors, infinite recursion and huge inputs', () => {
    const bad = new ReactImporter([{ path: 'Bad.tsx', code: 'export function Bad() { return <div className="p-4">' }]);
    expect(() => bad.components()).not.toThrow();
    const rec = convert([{ path: 'R.tsx', code: 'export function R() { return <div><R /><R /></div>; }' }], 'R');
    expect(rec.out[0]!.tree.nodes.length).toBeLessThan(50);
    const huge = new ReactImporter([{ path: 'H.tsx', code: 'x'.repeat(400_000) }]);
    expect(huge.errors[0]).toMatch(/troppo grande|too large/);
  });
});

describe('GitHub access', () => {
  it('parses GitHub URLs and rejects anything else', () => {
    expect(parseGithubUrl('https://github.com/shadcn-ui/ui/blob/main/apps/www/button.tsx')).toEqual({ owner: 'shadcn-ui', repo: 'ui', ref: 'main', path: 'apps/www/button.tsx', kind: 'file' });
    expect(parseGithubUrl('https://github.com/acme/ui/tree/dev/src')).toEqual({ owner: 'acme', repo: 'ui', ref: 'dev', path: 'src', kind: 'dir' });
    expect(parseGithubUrl('github.com/acme/ui.git')).toEqual({ owner: 'acme', repo: 'ui', path: '', kind: 'repo' });
    expect(parseGithubUrl('acme/ui/src/Button.tsx')).toMatchObject({ kind: 'file', path: 'src/Button.tsx' });
    expect(parseGithubUrl('https://raw.githubusercontent.com/acme/ui/main/src/A.tsx')).toMatchObject({ ref: 'main', path: 'src/A.tsx', kind: 'file' });
    expect(parseGithubUrl('https://evil.com/acme/ui')).toBeNull();
    expect(parseGithubUrl('javascript:alert(1)')).toBeNull();
    expect(parseGithubUrl('https://github.com/acme/ui/blob/main/../../x')).toBeNull();
  });

  it('resolves local imports including path aliases', () => {
    const files = ['src/components/ui/button.tsx', 'src/components/hero.tsx', 'src/lib/utils.ts', 'src/components/cards/index.tsx'].map((path) => ({ path, size: 1 }));
    expect(localImports("import { Button } from './ui/button'\nimport x from 'react'\nexport { A } from '@/components/cards'")).toEqual(['./ui/button', '@/components/cards']);
    expect(resolveImport('src/components/hero.tsx', './ui/button', files)).toBe('src/components/ui/button.tsx');
    expect(resolveImport('src/components/hero.tsx', '@/components/cards', files)).toBe('src/components/cards/index.tsx');
    expect(resolveImport('src/components/hero.tsx', '@/lib/utils', files)).toBe('src/lib/utils.ts');
    expect(resolveImport('src/components/hero.tsx', './missing', files)).toBeNull();
  });

  it('pins to a commit, sends the token only to api.github.com and enforces size limits', async () => {
    const sha = 'b'.repeat(40);
    const calls: { url: string; auth?: string }[] = [];
    const fake = vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      calls.push({ url, auth });
      const u = new URL(url);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (u.pathname === '/repos/o/r') return json({ default_branch: 'main', private: true });
      if (u.pathname === '/repos/o/r/commits/main') return json({ sha });
      if (u.pathname === `/repos/o/r/git/trees/${sha}`) return json({ tree: [{ path: 'src/A.tsx', type: 'blob', size: 10 }, { path: 'src/A.test.tsx', type: 'blob', size: 10 }, { path: 'node_modules/x/B.tsx', type: 'blob', size: 1 }, { path: 'src/big.tsx', type: 'blob', size: 1 }] });
      if (u.pathname === '/repos/o/r/license') return json({ message: 'Not Found' }, 404);
      if (u.pathname === '/repos/o/r/contents/src/A.tsx') return new Response('export const A = () => <div/>;');
      if (u.pathname === '/repos/o/r/contents/src/big.tsx') return new Response('x'.repeat(400_000));
      return json({}, 404);
    });
    const client = new GithubClient(fake, 'tok123');
    const ref = parseGithubUrl('https://github.com/o/r/tree/main/src')!;
    const snap = await client.snapshot(ref);
    expect(snap).toMatchObject({ sha, license: null, isPrivate: true });
    expect(filesUnder(snap, ref).map((f) => f.path)).toEqual(['src/A.tsx', 'src/big.tsx']);
    expect(await client.readFile(snap, 'src/A.tsx')).toContain('export const A');
    expect(calls.at(-1)!.url).toContain(`ref=${sha}`);
    await expect(client.readFile(snap, 'src/big.tsx')).rejects.toThrow(/troppo grande/);
    await expect(client.readFile(snap, '../etc/passwd')).rejects.toThrow();
    expect(calls.every((c) => c.url.startsWith('https://api.github.com/') && c.auth === 'Bearer tok123')).toBe(true);
  });
});
