/**
 * Maps design nodes to CSS declarations. Framework-independent: used by the editor
 * renderer and (later) by the code exporter so canvas and exported code stay in sync.
 */
import type { DesignNode, Effect, Paint, TextNode } from './schema';

export type CSSDecl = Record<string, string | number>;

export interface FontDef {
  family: string;
  stack: string;
  /** Bundled with the app (works offline). */
  bundled: boolean;
}

export const FONTS: FontDef[] = [
  { family: 'Inter', stack: "'Inter Variable', Inter, system-ui, sans-serif", bundled: true },
  { family: 'Space Grotesk', stack: "'Space Grotesk Variable', 'Space Grotesk', system-ui, sans-serif", bundled: true },
  { family: 'Playfair Display', stack: "'Playfair Display Variable', 'Playfair Display', Georgia, serif", bundled: true },
  { family: 'JetBrains Mono', stack: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", bundled: true },
  { family: 'System UI', stack: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', bundled: false },
  { family: 'Helvetica', stack: 'Helvetica Neue, Helvetica, Arial, sans-serif', bundled: false },
  { family: 'Georgia', stack: 'Georgia, Times New Roman, serif', bundled: false },
  { family: 'Courier', stack: 'Courier New, Courier, monospace', bundled: false },
];

export function fontStack(family: string): string {
  const def = FONTS.find((f) => f.family === family);
  if (def) return def.stack;
  // Family names are schema-restricted to [A-Za-z0-9 _-], so quoting is safe.
  return `'${family}', system-ui, sans-serif`;
}

export function hexToRgba(hex: string, alpha = 1): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  if (alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
}

function paintToCss(p: Paint): string {
  if (p.type === 'solid') {
    const c = hexToRgba(p.color, p.opacity);
    return `linear-gradient(${c}, ${c})`;
  }
  const stops = [...p.stops]
    .sort((a, b) => a.position - b.position)
    .map((s) => `${hexToRgba(s.color, p.opacity)} ${Math.round(s.position * 1000) / 10}%`)
    .join(', ');
  return `linear-gradient(${p.angle}deg, ${stops})`;
}

/** Fills are stored bottom → top; CSS lists background layers top → bottom. */
export function fillsToBackground(fills: Paint[]): string | undefined {
  const visible = fills.filter((f) => f.visible);
  if (!visible.length) return undefined;
  if (visible.length === 1 && visible[0]!.type === 'solid') return hexToRgba(visible[0]!.color, visible[0]!.opacity);
  return [...visible].reverse().map(paintToCss).join(', ');
}

function effectsToShadow(effects: Effect[], text: boolean): { shadow?: string; filter?: string } {
  const visible = effects.filter((e) => e.visible);
  const shadows = visible
    .filter((e) => e.type !== 'layer-blur' && !(text && e.type === 'inner-shadow'))
    .map((e) => {
      const c = hexToRgba(e.color, e.opacity);
      if (text) return `${e.x}px ${e.y}px ${e.blur}px ${c}`;
      return `${e.type === 'inner-shadow' ? 'inset ' : ''}${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${c}`;
    });
  const blur = visible.find((e) => e.type === 'layer-blur');
  return {
    shadow: shadows.length ? shadows.join(', ') : undefined,
    filter: blur ? `blur(${blur.blur}px)` : undefined,
  };
}

const px = (v: number) => `${Math.round(v * 100) / 100}px`;

const justify = { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' } as const;
const align = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

export interface StyleContext {
  /** Parent node (null when the node sits directly on a page). */
  parent: DesignNode | null;
}

function textStyle(node: TextNode, css: CSSDecl) {
  css.fontFamily = fontStack(node.fontFamily);
  css.fontSize = px(node.fontSize);
  css.fontWeight = node.fontWeight;
  css.fontStyle = node.italic ? 'italic' : 'normal';
  css.lineHeight =
    node.lineHeight.unit === 'auto' ? 'normal' : node.lineHeight.unit === 'px' ? px(node.lineHeight.value) : String(node.lineHeight.value / 100);
  css.letterSpacing = px(node.letterSpacing);
  css.textAlign = node.textAlign;
  css.textDecoration = node.textDecoration;
  css.textTransform = { none: 'none', upper: 'uppercase', lower: 'lowercase', title: 'capitalize' }[node.textCase];
  css.whiteSpace = node.sizing.horizontal === 'hug' ? 'pre' : 'pre-wrap';
  css.overflowWrap = 'break-word';
  const top = [...node.fills].reverse().find((f) => f.visible);
  if (top?.type === 'linear-gradient') {
    css.backgroundImage = paintToCss(top);
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    css.color = 'transparent';
  } else if (top) {
    css.color = hexToRgba(top.color, top.opacity);
  } else {
    css.color = 'transparent';
  }
}

export function nodeStyle(node: DesignNode, ctx: StyleContext): CSSDecl {
  const css: CSSDecl = { boxSizing: 'border-box' };
  const parent = ctx.parent;
  const parentLayout = parent?.type === 'frame' ? parent.layout.mode : 'none';
  const inFlow = parentLayout !== 'none' && node.layoutPositioning === 'auto';
  const isText = node.type === 'text';

  if (!node.visible) css.display = 'none';

  if (inFlow) {
    css.position = 'relative';
  } else {
    css.position = 'absolute';
    css.left = px(node.x);
    css.top = px(node.y);
  }

  // Sizing
  const horizontalIsPrimary = parentLayout === 'horizontal';
  const sizeAxis = (axis: 'horizontal' | 'vertical') => {
    const prop = axis === 'horizontal' ? 'width' : 'height';
    const value = axis === 'horizontal' ? node.width : node.height;
    let mode = node.sizing[axis];
    if (mode === 'fill' && !inFlow) mode = 'fixed';
    if (mode === 'hug' && !(isText || (node.type === 'frame' && node.layout.mode !== 'none'))) mode = 'fixed';
    if (mode === 'fixed') {
      css[prop] = px(value);
      if (inFlow) css.flexShrink = 0;
    } else if (mode === 'hug') {
      css[prop] = isText && axis === 'horizontal' ? 'max-content' : axis === 'horizontal' ? 'fit-content' : 'auto';
      if (inFlow) css.flexShrink = 0;
    } else {
      const isPrimary = (axis === 'horizontal') === horizontalIsPrimary;
      if (isPrimary) {
        css.flexGrow = 1;
        css.flexBasis = '0px';
        css.flexShrink = 1;
        css[axis === 'horizontal' ? 'minWidth' : 'minHeight'] = '0px';
      } else {
        css.alignSelf = 'stretch';
        css[prop] = 'auto';
      }
    }
  };
  sizeAxis('horizontal');
  sizeAxis('vertical');
  if (node.minWidth != null) css.minWidth = px(node.minWidth);
  if (node.maxWidth != null) css.maxWidth = px(node.maxWidth);
  if (node.minHeight != null) css.minHeight = px(node.minHeight);
  if (node.maxHeight != null) css.maxHeight = px(node.maxHeight);

  // Container layout
  if (node.type === 'frame') {
    const l = node.layout;
    if (l.mode !== 'none') {
      css.display = node.visible ? 'flex' : 'none';
      css.flexDirection = l.mode === 'horizontal' ? 'row' : 'column';
      css.gap = px(l.gap);
      css.padding = l.padding.map(px).join(' ');
      css.justifyContent = justify[l.primaryAlign];
      css.alignItems = align[l.counterAlign];
      css.flexWrap = l.wrap ? 'wrap' : 'nowrap';
    }
    if (node.clipContent) css.overflow = 'hidden';
  }

  // Appearance
  if (!isText && node.type !== 'line' && node.type !== 'icon') {
    const bg = fillsToBackground(node.fills);
    if (bg) css.background = bg;
  }
  if (node.stroke?.visible && node.stroke.width > 0 && node.type !== 'line' && node.type !== 'icon' && !isText) {
    css.border = `${px(node.stroke.width)} solid ${hexToRgba(node.stroke.color, node.stroke.opacity)}`;
  }
  if (node.type === 'ellipse') css.borderRadius = '50%';
  else if (node.radius.some((r) => r > 0)) {
    const [a, b, c, d] = node.radius;
    css.borderRadius = a === b && b === c && c === d ? px(a) : node.radius.map(px).join(' ');
  }
  const fx = effectsToShadow(node.effects, isText);
  if (fx.shadow) css[isText ? 'textShadow' : 'boxShadow'] = fx.shadow;
  if (fx.filter) css.filter = fx.filter;
  if (node.opacity < 1) css.opacity = node.opacity;

  if (node.type === 'text') textStyle(node, css);
  if (node.type === 'icon') {
    const top = [...node.fills].reverse().find((f) => f.visible && f.type === 'solid');
    css.color = top && top.type === 'solid' ? hexToRgba(top.color, top.opacity) : 'currentColor';
  }
  return css;
}

/** Converts camelCase declarations to a CSS text block (used by export). */
export function cssText(decl: CSSDecl): string {
  return Object.entries(decl)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/^webkit-/, '-webkit-')}: ${v};`)
    .join('\n');
}
