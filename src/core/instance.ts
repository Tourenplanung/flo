/**
 * Component instances. An instance is a leaf in the stored tree; its content is the main
 * component's subtree, expanded at render/export time with the instance's overrides applied.
 * Virtual layer ids are `${instanceId}__${sourceId}` so they can be selected and measured.
 */
import { INSTANCE_OVERRIDE_KEYS, type DesignNode, type FrameNode, type InstanceNode, type Project } from './schema';

export const VSEP = '__';

export function virtualId(instanceId: string, sourceId: string) {
  return `${instanceId}${VSEP}${sourceId}`;
}

/** Splits a (possibly nested) virtual id into the outermost instance id and the inner source id. */
export function parseVirtualId(id: string): { instanceId: string; sourceId: string } | null {
  const i = id.indexOf(VSEP);
  if (i < 0) return null;
  return { instanceId: id.slice(0, i), sourceId: id.slice(i + VSEP.length) };
}

export function isVirtualId(id: string) {
  return id.includes(VSEP);
}

export function getMainComponent(project: Project, inst: InstanceNode): FrameNode | null {
  const c = project.nodes[inst.componentId];
  return c && c.type === 'frame' && c.component ? c : null;
}

/** Components reachable from `componentId` through nested instances (for cycle checks). */
export function componentDependencies(project: Project, componentId: string, seen = new Set<string>()): Set<string> {
  if (seen.has(componentId)) return seen;
  seen.add(componentId);
  const visit = (id: string) => {
    const n = project.nodes[id];
    if (!n) return;
    if (n.type === 'instance') componentDependencies(project, n.componentId, seen);
    n.childIds.forEach(visit);
  };
  project.nodes[componentId]?.childIds.forEach(visit);
  return seen;
}

/** Ancestor main components of a node (an instance placed inside them must not reference them). */
export function enclosingComponents(project: Project, nodeId: string): string[] {
  const out: string[] = [];
  let cur = project.nodes[nodeId];
  let guard = 0;
  while (cur && guard++ < 10_000) {
    if (cur.type === 'frame' && cur.component) out.push(cur.id);
    cur = project.nodes[cur.parentId];
  }
  return out;
}

export interface Expansion {
  /** Root rendered in place of the instance (id = instance id). */
  root: DesignNode;
  /** All virtual descendants by virtual id. */
  nodes: Record<string, DesignNode>;
}

/** Expands an instance into a virtual subtree. Returns null when the main component is missing. */
export function expandInstance(project: Project, inst: InstanceNode, depth = 0): Expansion | null {
  const main = getMainComponent(project, inst);
  if (!main || depth > 8) return null;
  const nodes: Record<string, DesignNode> = {};
  const vid = (src: string) => virtualId(inst.id, src);

  const root: FrameNode = {
    ...main,
    id: inst.id,
    name: inst.name,
    parentId: inst.parentId,
    x: inst.x,
    y: inst.y,
    width: inst.width,
    height: inst.height,
    sizing: inst.sizing,
    minWidth: inst.minWidth ?? main.minWidth,
    maxWidth: inst.maxWidth ?? main.maxWidth,
    layoutPositioning: inst.layoutPositioning,
    constraints: inst.constraints,
    visible: inst.visible,
    locked: inst.locked,
    opacity: inst.opacity * main.opacity,
    responsive: inst.responsive,
    component: null,
    childIds: main.childIds.map(vid),
  };

  const visit = (srcId: string, parentVid: string) => {
    const src = project.nodes[srcId];
    if (!src) return;
    const ov = inst.overrides[srcId] ?? {};
    const picked: Record<string, unknown> = {};
    for (const k of INSTANCE_OVERRIDE_KEYS) if (k in ov) picked[k] = (ov as Record<string, unknown>)[k];
    const v = { ...src, ...picked, id: vid(srcId), parentId: parentVid, childIds: src.childIds.map(vid), locked: false } as DesignNode;
    if (v.type === 'frame') v.component = null;
    nodes[v.id] = v;
    src.childIds.forEach((c) => visit(c, v.id));
  };
  main.childIds.forEach((c) => visit(c, inst.id));
  return { root, nodes };
}

/** Instances in the project that reference any of the given components. */
export function instancesOf(project: Project, componentIds: Set<string>): InstanceNode[] {
  return Object.values(project.nodes).filter((n): n is InstanceNode => n.type === 'instance' && componentIds.has(n.componentId));
}

/** Components that belong to the same variant set as `component`. */
export function variantSiblings(project: Project, component: FrameNode): FrameNode[] {
  if (!component.component?.set) return [component];
  return Object.values(project.nodes).filter(
    (n): n is FrameNode => n.type === 'frame' && !!n.component && n.component.set === component.component!.set,
  );
}

/**
 * Converts an instance into regular layers (same id for the root, fresh ids for descendants),
 * baking in its overrides. Returns the new nodes root-first; nested instances stay instances.
 */
export function bakeInstance(project: Project, inst: InstanceNode, newId: () => string): DesignNode[] | null {
  const exp = expandInstance(project, inst);
  if (!exp) return null;
  const ids = new Map<string, string>([[inst.id, inst.id]]);
  for (const vid of Object.keys(exp.nodes)) ids.set(vid, newId());
  const clone = (n: DesignNode): DesignNode => {
    const c = JSON.parse(JSON.stringify(n)) as DesignNode;
    c.id = ids.get(n.id)!;
    c.parentId = n.id === inst.id ? inst.parentId : ids.get(n.parentId)!;
    c.childIds = n.childIds.map((x) => ids.get(x)!);
    return c;
  };
  return [clone(exp.root), ...Object.values(exp.nodes).map(clone)];
}
