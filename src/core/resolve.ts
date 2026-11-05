/**
 * Render-time resolution: breakpoint overrides (desktop-first cascade) and design-token bindings.
 * Resolved nodes are plain derived data; the stored document is never mutated, so editing a token
 * or a breakpoint override immediately updates every element that uses it.
 */
import type { Breakpoint, DesignNode, Paint, Project, Tokens } from './schema';

export function solidPaint(color: string, opacity = 1): Paint {
  return { type: 'solid', color, opacity, visible: true };
}

/** Breakpoints whose overrides apply when previewing `activeId`, widest first. */
export function breakpointChain(breakpoints: Breakpoint[], activeId: string | null): string[] {
  const active = breakpoints.find((b) => b.id === activeId);
  if (!active) return [];
  return breakpoints
    .filter((b) => b.maxWidth >= active.maxWidth)
    .sort((a, b) => b.maxWidth - a.maxWidth)
    .map((b) => b.id);
}

export function applyResponsive<T extends DesignNode>(node: T, chain: string[]): T {
  let out: T = node;
  for (const bp of chain) {
    const o = node.responsive[bp];
    if (o && Object.keys(o).length) out = { ...out, ...o } as T;
  }
  return out;
}

export function applyTokens<T extends DesignNode>(node: T, tokens: Tokens): T {
  const b = node.bindings;
  if (!b || !Object.keys(b).length) return node;
  const n = { ...node } as DesignNode;
  if (b.fill) {
    const t = tokens.colors.find((x) => x.id === b.fill);
    if (t) n.fills = n.fills.length ? [...n.fills.slice(0, -1), solidPaint(t.value, t.opacity)] : [solidPaint(t.value, t.opacity)];
  }
  if (b.stroke) {
    const t = tokens.colors.find((x) => x.id === b.stroke);
    if (t) n.stroke = { width: n.stroke?.width ?? 1, visible: true, color: t.value, opacity: t.opacity };
  }
  if (b.radius) {
    const t = tokens.radius.find((x) => x.id === b.radius);
    if (t) n.radius = [t.value, t.value, t.value, t.value];
  }
  if (b.shadow) {
    const t = tokens.shadows.find((x) => x.id === b.shadow);
    if (t) n.effects = [{ ...t.effect }];
  }
  if (n.type === 'text' && b.text) {
    const t = tokens.text.find((x) => x.id === b.text);
    if (t) Object.assign(n, { fontFamily: t.fontFamily, fontSize: t.fontSize, fontWeight: t.fontWeight, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing });
  }
  if (n.type === 'frame' && (b.gap || b.padding)) {
    const gap = b.gap ? tokens.spacing.find((x) => x.id === b.gap) : undefined;
    const pad = b.padding ? tokens.spacing.find((x) => x.id === b.padding) : undefined;
    n.layout = {
      ...n.layout,
      ...(gap ? { gap: gap.value } : {}),
      ...(pad ? { padding: [pad.value, pad.value, pad.value, pad.value] as [number, number, number, number] } : {}),
    };
  }
  return n as T;
}

/** Cache keyed by node identity (Immer keeps unchanged nodes referentially stable). */
let cacheTokens: Tokens | null = null;
let cacheChain = '';
let cache = new WeakMap<DesignNode, DesignNode>();

export function resolveNode<T extends DesignNode>(node: T, tokens: Tokens, chain: string[]): T {
  const key = chain.join(',');
  if (tokens !== cacheTokens || key !== cacheChain) {
    cacheTokens = tokens;
    cacheChain = key;
    cache = new WeakMap();
  }
  const hit = cache.get(node);
  if (hit) return hit as T;
  const resolved = applyTokens(applyResponsive(node, chain), tokens);
  cache.set(node, resolved);
  return resolved;
}

/** Convenience for non-render code: resolves a node of the project at the base breakpoint. */
export function resolvedBase(project: Project, id: string): DesignNode | undefined {
  const n = project.nodes[id];
  return n ? resolveNode(n, project.tokens, []) : undefined;
}
