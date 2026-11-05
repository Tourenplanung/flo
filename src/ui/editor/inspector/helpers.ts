import { useMemo } from 'react';
import type { DesignNode } from '@/core/schema';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { MIXED, type Mixed } from '@/ui/common/controls';

/** Returns the shared value of `get` across nodes, or MIXED when values differ. */
export function common<N extends DesignNode, T>(nodes: N[], get: (n: N) => T): T | Mixed {
  if (!nodes.length) return MIXED;
  const first = get(nodes[0]!);
  const key = JSON.stringify(first);
  return nodes.every((n) => JSON.stringify(get(n)) === key) ? first : MIXED;
}

export function useSelectedNodes(): DesignNode[] {
  const selection = useEditorStore((s) => s.selection);
  const nodes = useDocStore((s) => s.project?.nodes);
  return useMemo(() => selection.map((id) => nodes?.[id]).filter(Boolean) as DesignNode[], [selection, nodes]);
}

export function numOr(v: number | Mixed, fallback = 0): number {
  return v === MIXED ? fallback : v;
}
