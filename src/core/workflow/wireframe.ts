/**
 * Deterministic wireframe generator: one editable, auto-layout frame per sitemap page.
 * Output uses semantic roles and names so later steps (apply styles, responsive, export)
 * can work on it structurally.
 */
import { createFrame, createIcon, createImage, createText, solid } from '../factory';
import type { AutoLayout, DesignNode, FrameNode } from '../schema';
import type { SitemapValue } from './catalog';
import { DEVICES, type Device } from './placement';

export const WF = {
  page: '#FFFFFF',
  hero: '#F2F2F4',
  block: '#E4E4E9',
  text: '#2B2B33',
  muted: '#6B6B76',
  button: '#4A4A55',
  footer: '#E9E9EE',
};

const layout = (mode: AutoLayout['mode'], gap: number, padding: AutoLayout['padding'], primaryAlign: AutoLayout['primaryAlign'] = 'start', counterAlign: AutoLayout['counterAlign'] = 'start', wrap = false): AutoLayout => ({
  mode,
  gap,
  padding,
  primaryAlign,
  counterAlign,
  wrap,
});

class Builder {
  nodes: DesignNode[] = [];
  add<T extends DesignNode>(node: T, parent?: FrameNode): T {
    if (parent) {
      node.parentId = parent.id;
      node.layoutPositioning = 'auto';
      parent.childIds.push(node.id);
    }
    this.nodes.push(node);
    return node;
  }
}

export function buildWireframe(
  sitemap: SitemapValue,
  opts: { device: Device; brand: string; pageId: string; startX: number },
): { roots: string[]; nodes: DesignNode[] } {
  const { width, height } = DEVICES[opts.device];
  const mobile = opts.device === 'mobile';
  const padX = mobile ? 20 : opts.device === 'tablet' ? 40 : 80;
  const topLevel = sitemap.pages.filter((p) => p.depth === 0).map((p) => p.name);
  const b = new Builder();
  const roots: string[] = [];

  sitemap.pages.slice(0, 30).forEach((page, i) => {
    const root = b.add(
      createFrame(
        { parentId: opts.pageId, x: opts.startX + i * (width + 120), y: 0, width, height, name: page.name },
        { fills: [solid(WF.page)], layout: layout('vertical', 0, [0, 0, 0, 0]), sizing: { horizontal: 'fixed', vertical: 'hug' }, minHeight: height, role: 'main' },
      ),
    );
    roots.push(root.id);

    // Header with logo + navigation
    const header = b.add(
      createFrame({ parentId: root.id, name: 'Header', width, height: 72 }, {
        role: 'header',
        fills: [solid(WF.page)],
        stroke: { color: WF.block, opacity: 1, width: 1, visible: true },
        sizing: { horizontal: 'fill', vertical: 'hug' },
        layout: layout('horizontal', 24, [20, padX, 20, padX], 'space-between', 'center'),
      }),
      root,
    );
    b.add(createText({ parentId: header.id, name: 'Logo' }, { characters: opts.brand || 'Brand', fontSize: 20, fontWeight: 800, fills: [solid(WF.text)], role: 'span' }), header);
    const nav = b.add(
      createFrame({ parentId: header.id, name: 'Navigation' }, { role: 'nav', fills: [], clipContent: false, sizing: { horizontal: 'hug', vertical: 'hug' }, layout: layout('horizontal', 24, [0, 0, 0, 0], 'start', 'center') }),
      header,
    );
    if (mobile) {
      b.add(createIcon({ parentId: nav.id, name: 'Menu' }, 'menu', { fills: [solid(WF.text)] }), nav);
    } else {
      for (const name of topLevel.slice(0, 6)) {
        b.add(createText({ parentId: nav.id, name }, { characters: name, fontSize: 15, fontWeight: 500, fills: [solid(WF.muted)], role: 'a' }), nav);
      }
    }

    // Hero
    const hero = b.add(
      createFrame({ parentId: root.id, name: 'Hero', width, height: 360 }, {
        role: 'section',
        fills: [solid(WF.hero)],
        sizing: { horizontal: 'fill', vertical: 'hug' },
        layout: layout('vertical', 16, [mobile ? 48 : 96, padX, mobile ? 48 : 96, padX], 'start', 'center'),
      }),
      root,
    );
    b.add(
      createText({ parentId: hero.id, name: 'Heading' }, {
        characters: page.name,
        fontSize: mobile ? 34 : 52,
        fontWeight: 800,
        textAlign: 'center',
        fills: [solid(WF.text)],
        role: 'h1',
        lineHeight: { unit: 'percent', value: 115 },
      }),
      hero,
    );
    b.add(
      createText({ parentId: hero.id, name: 'Supporting text' }, {
        characters: 'Testo introduttivo della pagina: spiega in una o due frasi cosa trova qui l’utente.',
        fontSize: mobile ? 16 : 18,
        textAlign: 'center',
        fills: [solid(WF.muted)],
        sizing: mobile ? { horizontal: 'fill', vertical: 'hug' } : { horizontal: 'hug', vertical: 'hug' },
      }),
      hero,
    );
    const cta = b.add(
      createFrame({ parentId: hero.id, name: 'Primary button' }, {
        role: 'button',
        fills: [solid(WF.button)],
        radius: [6, 6, 6, 6],
        sizing: { horizontal: 'hug', vertical: 'hug' },
        layout: layout('horizontal', 8, [12, 22, 12, 22], 'center', 'center'),
      }),
      hero,
    );
    b.add(createText({ parentId: cta.id, name: 'Label' }, { characters: 'Call to action', fontSize: 15, fontWeight: 600, fills: [solid('#FFFFFF')], role: 'span' }), cta);

    // Content: cards for sub-pages (or generic blocks)
    const content = b.add(
      createFrame({ parentId: root.id, name: 'Content', width, height: 400 }, {
        role: 'section',
        fills: [],
        clipContent: false,
        sizing: { horizontal: 'fill', vertical: 'hug' },
        layout: layout('vertical', 24, [mobile ? 40 : 72, padX, mobile ? 40 : 72, padX], 'start', 'start'),
      }),
      root,
    );
    b.add(createText({ parentId: content.id, name: 'Section title' }, { characters: page.children.length ? 'Sezioni' : 'In evidenza', fontSize: mobile ? 24 : 30, fontWeight: 700, fills: [solid(WF.text)], role: 'h2' }), content);
    const row = b.add(
      createFrame({ parentId: content.id, name: 'Cards' }, {
        fills: [],
        clipContent: false,
        sizing: { horizontal: 'fill', vertical: 'hug' },
        layout: layout(mobile ? 'vertical' : 'horizontal', 24, [0, 0, 0, 0], 'start', 'start'),
      }),
      content,
    );
    const titles = page.children.length ? page.children.slice(0, 6) : ['Elemento 1', 'Elemento 2', 'Elemento 3'];
    for (const title of titles) {
      const card = b.add(
        createFrame({ parentId: row.id, name: 'Card', width: 300, height: 320 }, {
          role: 'article',
          fills: [solid(WF.page)],
          stroke: { color: WF.block, opacity: 1, width: 1, visible: true },
          radius: [8, 8, 8, 8],
          sizing: { horizontal: 'fill', vertical: 'hug' },
          layout: layout('vertical', 12, [16, 16, 20, 16]),
        }),
        row,
      );
      b.add(createImage({ parentId: card.id, name: 'Image', width: 268, height: 150 }, { alt: title, fills: [solid(WF.block)], radius: [4, 4, 4, 4], sizing: { horizontal: 'fill', vertical: 'fixed' } }), card);
      b.add(createText({ parentId: card.id, name: 'Card title' }, { characters: title, fontSize: 18, fontWeight: 700, fills: [solid(WF.text)], role: 'h3' }), card);
      b.add(
        createText({ parentId: card.id, name: 'Card text' }, {
          characters: 'Breve descrizione del contenuto.',
          fontSize: 15,
          fills: [solid(WF.muted)],
          sizing: { horizontal: 'fill', vertical: 'hug' },
        }),
        card,
      );
    }

    // Footer
    const footer = b.add(
      createFrame({ parentId: root.id, name: 'Footer', width, height: 120 }, {
        role: 'footer',
        fills: [solid(WF.footer)],
        sizing: { horizontal: 'fill', vertical: 'hug' },
        layout: layout(mobile ? 'vertical' : 'horizontal', 16, [32, padX, 32, padX], 'space-between', mobile ? 'start' : 'center'),
      }),
      root,
    );
    b.add(createText({ parentId: footer.id, name: 'Copyright' }, { characters: `© ${new Date().getFullYear()} ${opts.brand || 'Brand'}`, fontSize: 14, fills: [solid(WF.muted)], role: 'span' }), footer);
    b.add(createText({ parentId: footer.id, name: 'Footer links' }, { characters: 'Privacy · Termini · Contatti', fontSize: 14, fills: [solid(WF.muted)], role: 'span' }), footer);
  });

  return { roots, nodes: b.nodes };
}

/** Groups a flat, parent-first node list into insertable trees (root + descendants). */
export function treesFor(roots: string[], nodes: DesignNode[]): DesignNode[][] {
  const byParent = new Map<string, DesignNode[]>();
  for (const n of nodes) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return roots.map((r) => {
    const out: DesignNode[] = [];
    const visit = (id: string) => {
      const n = byId.get(id);
      if (!n) return;
      out.push(n);
      n.childIds.forEach(visit);
    };
    visit(r);
    return out;
  });
}
