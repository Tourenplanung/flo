/** Graph utilities and connection validation for workflows (pure). */
import type { Workflow, WorkflowEdge } from '../schema';
import { getSpec, portsCompatible, type PortSpec } from './catalog';

export function outputPort(wf: Workflow, nodeId: string, portId: string): PortSpec | undefined {
  const n = wf.nodes.find((x) => x.id === nodeId);
  return n ? getSpec(n.kind)?.outputs.find((p) => p.id === portId) : undefined;
}

export function inputPort(wf: Workflow, nodeId: string, portId: string): PortSpec | undefined {
  const n = wf.nodes.find((x) => x.id === nodeId);
  return n ? getSpec(n.kind)?.inputs.find((p) => p.id === portId) : undefined;
}

/** True when adding source → target would close a cycle. */
export function createsCycle(wf: Workflow, source: string, target: string): boolean {
  if (source === target) return true;
  const out = new Map<string, string[]>();
  for (const e of wf.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(out.get(cur) ?? []));
  }
  return false;
}

/** Returns an error message, or null when the connection is valid. */
export function validateConnection(wf: Workflow, e: Omit<WorkflowEdge, 'id'>): string | null {
  const from = outputPort(wf, e.source, e.sourcePort);
  const to = inputPort(wf, e.target, e.targetPort);
  if (!from) return 'Unknown output port';
  if (!to) return 'Unknown input port';
  if (!portsCompatible(from.type, to.type)) return `Incompatible ports: ${from.type} → ${to.type}`;
  if (wf.edges.some((x) => x.target === e.target && x.targetPort === e.targetPort)) return 'Input already connected';
  if (createsCycle(wf, e.source, e.target)) return 'Connection would create a cycle';
  return null;
}

/** Topological order (Kahn). Throws on cycles. */
export function topoOrder(wf: Workflow, subset?: Set<string>): string[] {
  const ids = wf.nodes.map((n) => n.id).filter((id) => !subset || subset.has(id));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const edges = wf.edges.filter((e) => indeg.has(e.source) && indeg.has(e.target));
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  // Keep a stable order: by x position, then id.
  const pos = new Map(wf.nodes.map((n) => [n.id, n.position.x * 10_000 + n.position.y]));
  const queue = ids.filter((id) => indeg.get(id) === 0).sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of edges.filter((x) => x.source === id)) {
      indeg.set(e.target, indeg.get(e.target)! - 1);
      if (indeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (order.length !== ids.length) throw new Error('Workflow contains a cycle');
  return order;
}

export function upstreamOf(wf: Workflow, nodeId: string): Set<string> {
  const result = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of wf.edges) if (e.target === cur && !result.has(e.source)) (result.add(e.source), stack.push(e.source));
  }
  return result;
}

export function downstreamOf(wf: Workflow, nodeId: string): Set<string> {
  const result = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of wf.edges) if (e.source === cur && !result.has(e.target)) (result.add(e.target), stack.push(e.target));
  }
  return result;
}
