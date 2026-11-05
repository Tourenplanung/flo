/** Generates a standalone semantic HTML + CSS page from design frames (shares `nodeStyle` with the canvas). */
import { expandInstance } from '../instance';
import { breakpointChain, resolveNode } from '../resolve';
import type { DesignNode, FrameRole, Project, TextRole, Tokens } from '../schema';
import { cssText, hexToRgba, nodeStyle, type CSSDecl } from '../style';

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

export function tokenSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token';
}

/** Replaces token-bound values in a declaration with CSS custom properties. */
function useTokenVars(n: DesignNode, decl: CSSDecl, tokens: Tokens) {
  const b = n.bindings;
  const color = (id: string | undefined) => {
    const t = id ? tokens.colors.find((x) => x.id === id) : undefined;
    return t ? `var(--color-${tokenSlug(t.name)})` : null;
  };
  const fill = color(b.fill);
  if (fill) {
    if (n.type === 'text' && typeof decl.color === 'string' && decl.color !== 'transparent') decl.color = fill;
    else if (n.type === 'icon') decl.color = fill;
    else if (n.fills.filter((f) => f.visible).length === 1 && decl.background) decl.background = fill;
  }
  const stroke = color(b.stroke);
  if (stroke && typeof decl.border === 'string') decl.border = decl.border.replace(/(rgba?\([^)]*\))$/, stroke);
  const radius = b.radius ? tokens.radius.find((x) => x.id === b.radius) : undefined;
  if (radius && decl.borderRadius) decl.borderRadius = `var(--radius-${tokenSlug(radius.name)})`;
  const gap = b.gap ? tokens.spacing.find((x) => x.id === b.gap) : undefined;
  if (gap && decl.gap) decl.gap = `var(--space-${tokenSlug(gap.name)})`;
  const pad = b.padding ? tokens.spacing.find((x) => x.id === b.padding) : undefined;
  if (pad && decl.padding) decl.padding = `var(--space-${tokenSlug(pad.name)})`;
  const text = b.text ? tokens.text.find((x) => x.id === b.text) : undefined;
  if (text && n.type === 'text') {
    const v = tokenSlug(text.name);
    decl.fontSize = `var(--text-${v}-size)`;
    decl.fontWeight = `var(--text-${v}-weight)`;
  }
}

function tokensCss(tokens: Tokens): string {
  const lines: string[] = [];
  for (const c of tokens.colors) lines.push(`--color-${tokenSlug(c.name)}: ${hexToRgba(c.value, c.opacity)};`);
  for (const t of tokens.text) lines.push(`--text-${tokenSlug(t.name)}-size: ${t.fontSize}px;`, `--text-${tokenSlug(t.name)}-weight: ${t.fontWeight};`);
  for (const x of tokens.spacing) lines.push(`--space-${tokenSlug(x.name)}: ${x.value}px;`);
  for (const x of tokens.radius) lines.push(`--radius-${tokenSlug(x.name)}: ${x.value}px;`);
  return lines.length ? `:root {\n  ${lines.join('\n  ')}\n}` : '';
}

function diffDecl(base: CSSDecl, next: CSSDecl): CSSDecl {
  const out: CSSDecl = {};
  for (const [k, v] of Object.entries(next)) if (base[k] !== v) out[k] = v;
  for (const k of Object.keys(base)) if (!(k in next)) out[k] = 'unset';
  return out;
}

export async function exportHtml(project: Project, rootIds: string[], title: string, host: HtmlExportHost): Promise<string> {
  const rules: string[] = [];
  const media = new Map<string, string[]>(); // breakpoint id -> rules
  const fonts = new Set<string>();
  let counter = 0;
  const cls = (n: DesignNode) => `${(n.type === 'text' ? n.role : n.type === 'frame' ? n.role : n.type).replace(/[^a-z0-9]/g, '')}-${++counter}`;
  const bps = [...project.breakpoints].sort((a, b) => b.maxWidth - a.maxWidth);
  const chains = new Map(bps.map((bp) => [bp.id, breakpointChain(project.breakpoints, bp.id)]));

  type Lookup = (id: string) => DesignNode | undefined;
  const baseLookup: Lookup = (id) => project.nodes[id];

  const styleFor = (n: DesignNode, parent: DesignNode | null, chain: string[], isRoot: boolean): CSSDecl => {
    const rn = resolveNode(n, project.tokens, chain);
    const rp = parent ? resolveNode(parent, project.tokens, chain) : null;
    const decl: CSSDecl = nodeStyle(rn, { parent: rp });
    if (isRoot) {
      delete decl.left;
      delete decl.top;
      delete decl.right;
      delete decl.bottom;
      decl.position = 'relative';
      decl.margin = '0 auto';
      decl.maxWidth = '100%';
    }
    if (rn.type === 'frame' && (rn.role === 'button' || rn.role === 'link')) Object.assign(decl, { font: 'inherit', cursor: 'pointer', textDecoration: 'none', color: 'inherit' });
    if (rn.type === 'text') Object.assign(decl, { margin: 0 });
    useTokenVars(rn, decl, project.tokens);
    return decl;
  };

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
    const decl = styleFor(n, parent, [], isRoot);
    if (n.type === 'text') fonts.add(resolveNode(n, project.tokens, []).fontFamily);
    const c = cls(n);
    rules.push(`.${c} {\n  ${cssText(decl).split('\n').join('\n  ')}\n}`);
    for (const bp of bps) {
      const d = diffDecl(decl, styleFor(n, parent, chains.get(bp.id)!, isRoot));
      if (Object.keys(d).length) media.set(bp.id, [...(media.get(bp.id) ?? []), `.${c} { ${cssText(d).split('\n').join(' ')} }`]);
    }
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
  const mediaCss = bps
    .filter((bp) => media.get(bp.id)?.length)
    .map((bp) => `@media (max-width: ${bp.maxWidth}px) {\n${media.get(bp.id)!.join('\n')}\n}`)
    .join('\n');
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
${tokensCss(project.tokens)}
${rules.join('\n')}
${mediaCss}
    </style>
  </head>
  <body>
${bodies.join('\n')}  </body>
</html>
`;
}
