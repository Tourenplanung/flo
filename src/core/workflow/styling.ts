/** Design-system derivation and deterministic style application. */
import { solid } from '../factory';
import type { DesignNode, FrameNode, Paint, Project } from '../schema';
import type { StylesValue } from './catalog';
import { contrastRatio, hexToRgb, luminance, mix, readableOn } from './color';

export interface DesignSystemParams {
  primary: string;
  background: string;
  text: string;
  headingFont: string;
  bodyFont: string;
  baseSize: number;
  scale: number;
  radius: number;
  spacing: number;
}

export function deriveStyles(p: DesignSystemParams): StylesValue {
  const r = p.scale;
  const size = (n: number) => Math.round(p.baseSize * r ** n);
  return {
    type: 'styles',
    colors: {
      primary: p.primary.toUpperCase(),
      onPrimary: readableOn(p.primary),
      background: p.background.toUpperCase(),
      surface: mix(p.background, p.text, 0.035),
      text: p.text.toUpperCase(),
      muted: mix(p.text, p.background, 0.38),
      border: mix(p.background, p.text, 0.12),
    },
    fonts: { heading: p.headingFont, body: p.bodyFont },
    sizes: { h1: size(5), h2: size(3), h3: size(1.5), body: p.baseSize, small: Math.max(10, size(-1)) },
    radius: p.radius,
    spacing: p.spacing,
  };
}

function topSolid(fills: Paint[]): string | null {
  const f = [...fills].reverse().find((x) => x.visible && x.type === 'solid');
  return f && f.type === 'solid' ? f.color : null;
}

const isLightGray = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 12 && luminance([r, g, b]) > 0.6 && luminance([r, g, b]) < 0.98;
};

const isMutedText = (hex: string) => {
  const l = luminance(hexToRgb(hex));
  return l > 0.08 && l < 0.6;
};

/**
 * Computes style updates for one node. `ancestors` is the chain from the top-level frame
 * down to the node's parent (used for context such as "inside a button").
 */
export function styleNode(node: DesignNode, ancestors: DesignNode[], s: StylesValue): Partial<DesignNode> {
  const c = s.colors;
  const k = s.spacing / 8;
  const inRole = (role: string) => ancestors.some((a) => a.type === 'frame' && a.role === role);
  const isTop = ancestors.length === 0;
  const props: Partial<DesignNode> = {};

  if (node.stroke?.visible) props.stroke = { ...node.stroke, color: c.border };

  if (node.type === 'frame') {
    const f = node as FrameNode;
    if (f.layout.mode !== 'none' && k !== 1) {
      (props as Partial<FrameNode>).layout = {
        ...f.layout,
        gap: Math.round(f.layout.gap * k),
        padding: f.layout.padding.map((v) => Math.round(v * k)) as FrameNode['layout']['padding'],
      };
    }
    const fill = topSolid(f.fills);
    if (isTop) props.fills = [solid(c.background)];
    else if (f.role === 'button') {
      props.fills = [solid(c.primary)];
      props.radius = [s.radius, s.radius, s.radius, s.radius];
      props.stroke = null;
    } else if (f.role === 'footer') props.fills = [solid(c.text)];
    else if (f.role === 'header' || f.role === 'nav') props.fills = fill ? [solid(c.background)] : [];
    else if (f.role === 'article') {
      props.fills = [solid(c.surface)];
      props.radius = [s.radius * 1.5, s.radius * 1.5, s.radius * 1.5, s.radius * 1.5];
      props.stroke = { color: c.border, opacity: 1, width: 1, visible: true };
    } else if (f.role === 'input') {
      props.fills = [solid(c.background)];
      props.radius = [s.radius, s.radius, s.radius, s.radius];
    } else if (fill && f.role === 'section' && isLightGray(fill)) props.fills = [solid(c.background), solid(c.primary, 0.07)];
    else if (fill && isLightGray(fill)) props.fills = [solid(c.surface)];
  }

  if (node.type === 'rect' || node.type === 'ellipse' || node.type === 'image') {
    const fill = topSolid(node.fills);
    if (fill && isLightGray(fill)) props.fills = [solid(node.type === 'image' ? c.border : c.surface)];
    if (node.type !== 'ellipse' && node.radius.some((r) => r > 0)) props.radius = [s.radius, s.radius, s.radius, s.radius];
  }

  if (node.type === 'text') {
    const heading = /^h[1-6]$/.test(node.role);
    const color = topSolid(node.fills) ?? c.text;
    let target = isMutedText(color) ? c.muted : c.text;
    if (inRole('button')) target = c.onPrimary;
    else if (inRole('footer')) target = isMutedText(color) ? mix(c.background, c.text, 0.35) : c.background;
    props.fills = [solid(target)];
    Object.assign(props, {
      fontFamily: heading ? s.fonts.heading : s.fonts.body,
      fontSize:
        node.role === 'h1' ? s.sizes.h1 : node.role === 'h2' ? s.sizes.h2 : heading ? s.sizes.h3 : node.fontSize <= 14 ? s.sizes.small : s.sizes.body,
    });
    if (heading) Object.assign(props, { letterSpacing: node.role === 'h1' ? -1 : -0.3 });
  }

  if (node.type === 'icon') props.fills = [solid(inRole('button') ? c.onPrimary : c.text)];
  return props;
}

/** Applies `styleNode` to every node of the given subtrees, mutating plain node objects. */
export function styleTree(nodes: Record<string, DesignNode>, rootIds: string[], s: StylesValue) {
  const visit = (id: string, ancestors: DesignNode[]) => {
    const n = nodes[id];
    if (!n) return;
    Object.assign(n, styleNode(n, ancestors, s));
    n.childIds.forEach((c) => visit(c, [...ancestors, n]));
  };
  rootIds.forEach((id) => visit(id, []));
}

/** Update props for nodes of the project (in-place mode). */
export function styleUpdates(project: Project, rootIds: string[], s: StylesValue): { id: string; props: Partial<DesignNode> }[] {
  const out: { id: string; props: Partial<DesignNode> }[] = [];
  const visit = (id: string, ancestors: DesignNode[]) => {
    const n = project.nodes[id];
    if (!n) return;
    const props = styleNode(n, ancestors, s);
    if (Object.keys(props).length) out.push({ id, props });
    n.childIds.forEach((c) => visit(c, [...ancestors, n]));
  };
  rootIds.forEach((id) => visit(id, []));
  return out;
}

export { contrastRatio };
