import { Component, Crosshair, Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { DesignNode, FrameNode } from '@/core/schema';
import { openInCanvas } from '@/editor/workflowActions';
import { useT } from '@/i18n';
import { useDocStore } from '@/store/docStore';
import { IconButton } from '@/ui/common/controls';
import { insertInstance } from '../inspector/SystemSections';

export function ComponentsPanel() {
  const t = useT();
  const nodes = useDocStore((s) => s.project?.nodes);
  const project = useDocStore((s) => s.project);
  const sets = useMemo(() => {
    const comps = Object.values(nodes ?? {}).filter((n): n is FrameNode => n.type === 'frame' && !!n.component);
    const bySet = new Map<string, FrameNode[]>();
    for (const c of comps) bySet.set(c.component!.set || c.name, [...(bySet.get(c.component!.set || c.name) ?? []), c]);
    return [...bySet.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [nodes]);
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of Object.values(nodes ?? {})) if (n.type === 'instance') m.set(n.componentId, (m.get(n.componentId) ?? 0) + 1);
    return m;
  }, [nodes]);

  if (!sets.length) return <p className="px-3 py-3 text-[11px] leading-4 text-fg-subtle">{t('comp.empty')}</p>;
  const pageOf = (n: DesignNode) => {
    let cur = n;
    while (project?.nodes[cur.parentId]) cur = project.nodes[cur.parentId]!;
    return cur.parentId;
  };
  return (
    <div className="flex flex-col gap-3 p-2" data-testid="components-panel">
      {sets.map(([set, comps]) => (
        <section key={set}>
          <h4 className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">{set}</h4>
          {comps.map((c) => {
            const variant = Object.entries(c.component!.variant).map(([k, v]) => `${k}: ${v}`).join(' · ');
            return (
              <div key={c.id} className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-field-hover">
                <Component size={13} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-fg">{c.name}</div>
                  <div className="truncate text-[10px] text-fg-subtle">
                    {variant || '—'} · {usage.get(c.id) ?? 0}×
                  </div>
                </div>
                <IconButton label={t('comp.goMain')} onClick={() => openInCanvas(pageOf(c), [c.id])}>
                  <Crosshair size={12} />
                </IconButton>
                <IconButton label={t('comp.insert')} onClick={() => insertInstance(c.id)} testId={`comp-insert-${c.name}`}>
                  <Plus size={13} />
                </IconButton>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
