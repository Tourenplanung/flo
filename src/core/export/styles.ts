/**
 * Shared CSS generation for exporters (HTML, React): the same `nodeStyle` mapping as the
 * canvas, design tokens as CSS custom properties, breakpoint overrides as @media rules.
 */
import { breakpointChain, resolveNode } from '../resolve';
import type { DesignNode, FrameRole, Project, TextRole, Tokens } from '../schema';
import { cssText, hexToRgba, nodeStyle, type CSSDecl } from '../style';

export const FRAME_TAG: Record<FrameRole, string> = {
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

export const TEXT_TAG: Record<TextRole, string> = { p: 'p', span: 'span', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', label: 'label', a: 'a' };

export const FONT_IMPORT: Record<string, string> = {
  Inter: 'Inter:wght@100..900',
  'Space Grotesk': 'Space+Grotesk:wght@300..700',
  'Playfair Display': 'Playfair+Display:wght@400..900',
  'JetBrains Mono': 'JetBrains+Mono:wght@100..800',
};

export function fontLinkHref(fonts: Iterable<string>): string | null {
  const families = [...new Set(fonts)].filter((f) => FONT_IMPORT[f]).map((f) => `family=${FONT_IMPORT[f]}`);
  return families.length ? `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap` : null;
}

export function tokenSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'token';
}

/** Replaces token-bound values in a declaration with CSS custom properties. */
export function useTokenVars(n: DesignNode, decl: CSSDecl, tokens: Tokens) {
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

export function tokensCss(tokens: Tokens): string {
  const lines: string[] = [];
  for (const c of tokens.colors) lines.push(`--color-${tokenSlug(c.name)}: ${hexToRgba(c.value, c.opacity)};`);
  for (const t of tokens.text) lines.push(`--text-${tokenSlug(t.name)}-size: ${t.fontSize}px;`, `--text-${tokenSlug(t.name)}-weight: ${t.fontWeight};`);
  for (const x of tokens.spacing) lines.push(`--space-${tokenSlug(x.name)}: ${x.value}px;`);
  for (const x of tokens.radius) lines.push(`--radius-${tokenSlug(x.name)}: ${x.value}px;`);
  return lines.length ? `:root {\n  ${lines.join('\n  ')}\n}` : '';
}

export function diffDecl(base: CSSDecl, next: CSSDecl): CSSDecl {
  const out: CSSDecl = {};
  for (const [k, v] of Object.entries(next)) if (base[k] !== v) out[k] = v;
  for (const k of Object.keys(base)) if (!(k in next)) out[k] = 'unset';
  return out;
}

/** Collects class rules (base + per-breakpoint) for a stylesheet. */
export class StyleBuilder {
  private rules: string[] = [];
  private media = new Map<string, string[]>();
  readonly fonts = new Set<string>();
  private bps;
  private chains;

  constructor(private project: Project) {
    this.bps = [...project.breakpoints].sort((a, b) => b.maxWidth - a.maxWidth);
    this.chains = new Map(this.bps.map((bp) => [bp.id, breakpointChain(project.breakpoints, bp.id)]));
  }

  /** CSS declaration for a node at a breakpoint chain (roots become centered, fluid-capped pages). */
  decl(n: DesignNode, parent: DesignNode | null, chain: string[], isRoot: boolean): CSSDecl {
    const rn = resolveNode(n, this.project.tokens, chain);
    const rp = parent ? resolveNode(parent, this.project.tokens, chain) : null;
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
    useTokenVars(rn, decl, this.project.tokens);
    return decl;
  }

  /** Adds `.className` rules for a node and returns its base declaration. */
  add(className: string, n: DesignNode, parent: DesignNode | null, isRoot: boolean): CSSDecl {
    const base = this.decl(n, parent, [], isRoot);
    if (n.type === 'text') this.fonts.add(resolveNode(n, this.project.tokens, []).fontFamily);
    this.rules.push(`.${className} {\n  ${cssText(base).split('\n').join('\n  ')}\n}`);
    for (const bp of this.bps) {
      const d = diffDecl(base, this.decl(n, parent, this.chains.get(bp.id)!, isRoot));
      if (Object.keys(d).length) this.media.set(bp.id, [...(this.media.get(bp.id) ?? []), `.${className} { ${cssText(d).split('\n').join(' ')} }`]);
    }
    return base;
  }

  /** Adds a raw rule (e.g. instance positioning). */
  raw(rule: string) {
    this.rules.push(rule);
  }

  css(options: { tokens?: boolean } = {}): string {
    const media = this.bps
      .filter((bp) => this.media.get(bp.id)?.length)
      .map((bp) => `@media (max-width: ${bp.maxWidth}px) {\n${this.media.get(bp.id)!.join('\n')}\n}`);
    return [options.tokens ? tokensCss(this.project.tokens) : '', ...this.rules, ...media].filter(Boolean).join('\n');
  }
}
