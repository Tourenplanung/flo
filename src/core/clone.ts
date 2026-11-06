import { createId } from './ids';
import type { DesignNode } from './schema';

/** Deep-clones a subtree with fresh ids. Returns nodes root-first, ready for `insertTree`. */
export function cloneSubtree(source: Record<string, DesignNode>, rootId: string, newParentId: string): DesignNode[] {
  const idMap = new Map<string, string>();
  const order: DesignNode[] = [];
  const visit = (id: string) => {
    const n = source[id];
    if (!n) return;
    idMap.set(id, createId());
    order.push(n);
    n.childIds.forEach(visit);
  };
  visit(rootId);
  return order.map((n) => {
    const copy = JSON.parse(JSON.stringify(n)) as DesignNode;
    copy.id = idMap.get(n.id)!;
    copy.parentId = n.id === rootId ? newParentId : idMap.get(n.parentId)!;
    copy.childIds = n.childIds.map((c) => idMap.get(c)!).filter(Boolean);
    // Interactions that target layers inside the copied subtree now target their copies.
    copy.interactions = (copy.interactions ?? []).map((i) =>
      i.action.type === 'toggle-visibility' && idMap.has(i.action.targetId) ? { ...i, action: { ...i.action, targetId: idMap.get(i.action.targetId)! } } : i,
    );
    return copy;
  });
}
