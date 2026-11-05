/** Generates a standalone semantic HTML + CSS page from design frames (shares `nodeStyle` with the canvas). */
import type { DesignNode, FrameRole, Project, TextRole } from '../schema';
import { cssText, nodeStyle, type CSSDecl } from '../style';

export interface HtmlExportHost {
  getAssetDataUrl?(assetId: string): Promise<string | null>;
  iconSvg?(name: string, strokeWidth: number): Promise<string>;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const FRAME_TAG: Record<FrameRole, string> = {
  div: 'div',
  section: 'section',
  header: 'header',
  nav: 'nav',
  main: 'main',
  footer: 'footer',
  aside: 'aside',
  article: 'article',
  button: 'button',
  input: 'div',
  link: 'a',
};

const TEXT_TAG: Record<TextRole, string> = { p: 'p', span: 'span', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', label: 'label', a: 'a' };

const FONT_IMPORT: Record<string, string> = {
  Inter: 'Inter:wght@100..900',
  'Space Grotesk': 'Space+Grotesk:wght@300..700',
  'Playfair Display': 'Playfair+Display:wght@400..900',
  'JetBrains Mono': 'JetBrains+Mono:wght@100..800',
};

export async function exportHtml(project: Project, rootIds: string[], title: string, host: HtmlExportHost): Promise<string> {
  const rules: string[] = [];
  const fonts = new Set<string>();
  let counter = 0;
  const cls = (n: DesignNode) => `${(n.type === 'text' ? n.role : n.type === 'frame' ? n.role : n.type).replace(/[^a-z0-9]/g, '')}-${++counter}`;

  const render = async (id: string, depth: number, isRoot: boolean): Promise<string> => {
    const n = project.nodes[id];
    if (!n || !n.visible) return '';
    const parent = isRoot ? null : project.nodes[n.parentId] ?? null;
    const decl: CSSDecl = nodeStyle(n, { parent });
    if (isRoot) {
      delete decl.left;
      delete decl.top;
      decl.position = 'relative';
      decl.margin = '0 auto';
      decl.maxWidth = '100%';
    }
    if (n.type === 'frame' && (n.role === 'button' || n.role === 'link')) Object.assign(decl, { font: 'inherit', cursor: 'pointer', textDecoration: 'none', color: 'inherit' });
    if (n.type === 'text') {
      fonts.add(n.fontFamily);
      Object.assign(decl, { margin: 0 });
    }
    const c = cls(n);
    rules.push(`.${c} {\n  ${cssText(decl).split('\n').join('\n  ')}\n}`);
    const pad = '  '.repeat(depth + 2);
    const kids = (await Promise.all(n.childIds.map((cid) => render(cid, depth + 1, false)))).join('');
    switch (n.type) {
      case 'text': {
        const tag = TEXT_TAG[n.role];
        const href = tag === 'a' ? ' href="#"' : '';
        return `${pad}<${tag} class="${c}"${href}>${escapeHtml(n.characters)}</${tag}>\n`;
      }
      case 'image': {
        const url = n.assetId && host.getAssetDataUrl ? await host.getAssetDataUrl(n.assetId) : null;
        if (url) return `${pad}<img class="${c}" src="${escapeHtml(url)}" alt="${escapeHtml(n.alt)}" style="object-fit: ${n.fit}" />\n`;
        return `${pad}<div class="${c}" role="img" aria-label="${escapeHtml(n.alt || n.name)}"></div>\n`;
      }
      case 'icon': {
        const svg = host.iconSvg ? await host.iconSvg(n.icon, n.strokeWidth) : '';
        return `${pad}<span class="${c}" aria-hidden="true">${svg}</span>\n`;
      }
      case 'line': {
        const s = n.stroke;
        const y1 = n.flip ? n.height : 0;
        const y2 = n.flip ? 0 : n.height;
        return `${pad}<svg class="${c}" width="${n.width}" height="${Math.max(n.height, 1)}" style="overflow: visible" aria-hidden="true"><line x1="0" y1="${y1}" x2="${n.width}" y2="${y2}" stroke="${s?.color ?? '#000'}" stroke-opacity="${s?.opacity ?? 1}" stroke-width="${s?.width ?? 1}" /></svg>\n`;
      }
      case 'frame': {
        const tag = FRAME_TAG[n.role];
        const attrs = tag === 'button' ? ' type="button"' : tag === 'a' ? ' href="#"' : n.role === 'input' ? ' role="textbox"' : '';
        return `${pad}<${tag} class="${c}"${attrs}>\n${kids}${pad}</${tag}>\n`;
      }
      default:
        return `${pad}<div class="${c}">\n${kids}${pad}</div>\n`;
    }
  };

  const bodies: string[] = [];
  for (const id of rootIds) bodies.push(await render(id, 0, true));
  const families = [...fonts].filter((f) => FONT_IMPORT[f]).map((f) => `family=${FONT_IMPORT[f]}`);
  const fontLink = families.length ? `    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?${families.join('&')}&display=swap" />\n` : '';
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
${fontLink}    <style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #f4f4f6; -webkit-font-smoothing: antialiased; }
button { border: 0; padding: 0; background: none; }
svg { display: block; }
${rules.join('\n')}
    </style>
  </head>
  <body>
${bodies.join('\n')}  </body>
</html>
`;
}
