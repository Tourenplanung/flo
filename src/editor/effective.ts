/** Editor-side helpers to obtain what a layer looks like at the active breakpoint. */
import { useMemo } from 'react';
import { expandInstance, parseVirtualId } from '@/core/instance';
import { breakpointChain, resolveNode } from '@/core/resolve';
import type { DesignNode, InstanceNode, Project } from '@/core/schema';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';

export function chainFor(project: Project, breakpointId: string | null): string[] {
  return breakpointChain(project.breakpoints, breakpointId);
}

export function activeChain(project: Project): string[] {
  return chainFor(project, useEditorStore.getState().breakpointId);
}

export function useChain(): string[] {
  const bps = useDocStore((s) => s.project?.breakpoints);
  const bp = useEditorStore((s) => s.breakpointId);
  return useMemo(() => (bps ? breakpointChain(bps, bp) : []), [bps, bp]);
}

/** Width a top-level screen frame takes when previewing a breakpoint (unless overridden). */
export function previewWidth(project: Project, node: DesignNode, chain: string[]): number | null {
  if (!chain.length || project.nodes[node.parentId] || node.type !== 'frame') return null;
  const active = project.breakpoints.find((b) => b.id === chain[chain.length - 1]);
  if (!active) return null;
  if (chain.some((bp) => node.responsive[bp]?.width !== undefined)) return null;
  // Only "screens" (frames wider than the breakpoint) are previewed at the breakpoint width.
  return node.width > active.maxWidth ? active.previewWidth : null;
}

/** Resolved node (tokens + responsive), including virtual layers inside instances. */
export function effectiveNode(project: Project, id: string, chain: string[]): DesignNode | undefined {
  const v = parseVirtualId(id);
  if (v) {
    const inst = project.nodes[v.instanceId];
    if (!inst || inst.type !== 'instance') return undefined;
    const exp = expandInstance(project, inst as InstanceNode);
    const n = exp?.nodes[id];
    return n ? resolveNode(n, project.tokens, chain) : undefined;
  }
  const n = project.nodes[id];
  if (!n) return undefined;
  const r = resolveNode(n, project.tokens, chain);
  const w = previewWidth(project, n, chain);
  return w !== null ? { ...r, width: w } : r;
}
