/** Generates a standalone semantic HTML + CSS page from design frames (shares `nodeStyle` with the canvas). */
import { expandInstance } from '../instance';
import { FRAME_TAG, fontLinkHref, StyleBuilder, TEXT_TAG } from '../export/styles';
import { resolveNode } from '../resolve';
import type { DesignNode, Project } from '../schema';

export { tokenSlug } from '../export/styles';

export interface HtmlExportHost {
  getAssetDataUrl?(assetId: string): Promise<string | null>;
  iconSvg?(name: string, strokeWidth: number): Promise<string>;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function exportHtml(project: Project, rootIds: string[], title: string, host: HtmlExportHost): Promise<string> {
  const styles = new StyleBuilder(project);
  let counter = 0;
  const cls = (n: DesignNode) => `${(n.type === 'text' ? n.role : n.type === 'frame' ? n.role : n.type).replace(/[^a-z0-9]/g, '')}-${++counter}`;
  type Lookup = (id: string) => DesignNode | undefined;
  const baseLookup: Lookup = (id) => project.nodes[id];

  const render = async (n: DesignNode, lookup: Lookup, depth: number, isRoot: boolean): Promise<string> => {
    // Instances render their main component's content.
    if (n.type === 'instance') {
      const exp = expandInstance(project, n);
      if (!exp) return '';
      const local: Lookup = (id) => exp.nodes[id] ?? lookup(id);
      return render(exp.root, local, depth, isRoot);
    }
    const visibleSomewhere = n.visible || Object.values(n.responsive).some((o) => o.visible);
    if (!visibleSomewhere) return '';
    const parent = isRoot ? null : lookup(n.parentId) ?? null;
    const c = cls(n);
    styles.add(c, n, parent, isRoot);
    const pad = '  '.repeat(depth + 2);
    const children: string[] = [];
    for (const cid of n.childIds) {
      const child = lookup(cid);
      if (child) children.push(await render(child, lookup, depth + 1, false));
    }
    const kids = children.join('');
    const r = resolveNode(n, project.tokens, []);
    switch (r.type) {
      case 'text': {
        const tag = TEXT_TAG[r.role];
        const href = tag === 'a' ? ' href="#"' : '';
        return `${pad}<${tag} class="${c}"${href}>${escapeHtml(r.characters)}</${tag}>\n`;
      }
      case 'image': {
        const url = r.assetId && host.getAssetDataUrl ? await host.getAssetDataUrl(r.assetId) : null;
        if (url) return `${pad}<img class="${c}" src="${escapeHtml(url)}" alt="${escapeHtml(r.alt)}" style="object-fit: ${r.fit}" />\n`;
        return `${pad}<div class="${c}" role="img" aria-label="${escapeHtml(r.alt || r.name)}"></div>\n`;
      }
      case 'icon': {
        const svg = host.iconSvg ? await host.iconSvg(r.icon, r.strokeWidth) : '';
        return `${pad}<span class="${c}" aria-hidden="true">${svg}</span>\n`;
      }
      case 'line': {
        const st = r.stroke;
        const y1 = r.flip ? r.height : 0;
        const y2 = r.flip ? 0 : r.height;
        return `${pad}<svg class="${c}" width="${r.width}" height="${Math.max(r.height, 1)}" style="overflow: visible" aria-hidden="true"><line x1="0" y1="${y1}" x2="${r.width}" y2="${y2}" stroke="${st?.color ?? '#000'}" stroke-opacity="${st?.opacity ?? 1}" stroke-width="${st?.width ?? 1}" /></svg>\n`;
      }
      case 'frame': {
        const tag = FRAME_TAG[r.role];
        const attrs = tag === 'button' ? ' type="button"' : tag === 'a' ? ' href="#"' : r.role === 'input' ? ' role="textbox"' : '';
        return `${pad}<${tag} class="${c}"${attrs}>\n${kids}${pad}</${tag}>\n`;
      }
      default:
        return `${pad}<div class="${c}">\n${kids}${pad}</div>\n`;
    }
  };

  const bodies: string[] = [];
  for (const id of rootIds) {
    const n = baseLookup(id);
    if (n) bodies.push(await render(n, baseLookup, 0, true));
  }
  const href = fontLinkHref(styles.fonts);
  const fontLink = href ? `    <link rel="stylesheet" href="${href}" />\n` : '';
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
${styles.css({ tokens: true })}
    </style>
  </head>
  <body>
${bodies.join('\n')}  </body>
</html>
`;
}
