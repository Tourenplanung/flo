import { useMemo } from 'react';
import type { DesignNode } from '@/core/schema';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { effectiveNode, useChain } from '@/editor/effective';
import { MIXED, type Mixed } from '@/ui/common/controls';

/** Returns the shared value of `get` across nodes, or MIXED when values differ. */
export function common<N extends DesignNode, T>(nodes: N[], get: (n: N) => T): T | Mixed {
  if (!nodes.length) return MIXED;
  const first = get(nodes[0]!);
  const key = JSON.stringify(first);
  return nodes.every((n) => JSON.stringify(get(n)) === key) ? first : MIXED;
}

/** Selected layers as they look in the current editing context (tokens, breakpoint, instance layers). */
export function useSelectedNodes(): DesignNode[] {
  const selection = useEditorStore((s) => s.selection);
  const project = useDocStore((s) => s.project);
  const chain = useChain();
  return useMemo(
    () => (project ? (selection.map((id) => effectiveNode(project, id, chain)).filter(Boolean) as DesignNode[]) : []),
    [selection, project, chain],
  );
}

export function numOr(v: number | Mixed, fallback = 0): number {
  return v === MIXED ? fallback : v;
}
