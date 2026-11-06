import { Play, RotateCw } from 'lucide-react';
import { useEffect } from 'react';
import { createEmptyWorkflow } from '@/editor/workflowActions';
import { useT } from '@/i18n';
import { useDocStore } from '@/store/docStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { FlowCanvas } from './FlowCanvas';
import { NodeInspector } from './NodeInspector';
import { WorkflowSidebar } from './WorkflowSidebar';
import { DrawerButtons, SidePanel } from '@/ui/common/layout';

export function WorkflowView() {
  const t = useT();
  const workflows = useDocStore((s) => s.project?.workflows ?? []);
  const activeId = useWorkflowStore((s) => s.activeId);
  const running = useWorkflowStore((s) => s.running);
  const active = workflows.find((w) => w.id === activeId);

  // Keep a valid active workflow (e.g. after undo removed it).
  useEffect(() => {
    if (!active && workflows[0]) useWorkflowStore.getState().setActive(workflows[0].id);
  }, [active, workflows]);

  return (
    <div className="relative flex min-h-0 flex-1" data-testid="workflow-view">
      <WorkflowSidebar />
      <main className="relative min-w-0 flex-1 bg-canvas">
        {active ? (
          <>
            <FlowCanvas workflow={active} />
            <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg border border-line-strong bg-elevated/95 p-1 shadow-xl backdrop-blur">
              <span className="max-w-60 truncate px-2 text-[12px] font-medium text-fg">{active.name}</span>
              <button
                data-testid="wf-run-all"
                disabled={running || !active.nodes.length}
                onClick={() => void useWorkflowStore.getState().run(active.id)}
                className="flex items-center gap-1.5 rounded-md bg-accent-strong px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent disabled:opacity-50"
              >
                <Play size={12} /> {running ? t('wf.running') : t('wf.runAll')}
              </button>
              <button
                title={t('wf.rerunAll')}
                aria-label={t('wf.rerunAll')}
                disabled={running || !active.nodes.length}
                onClick={() => void useWorkflowStore.getState().run(active.id, { force: true })}
                className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted hover:bg-field-hover hover:text-fg disabled:opacity-40"
              >
                <RotateCw size={12} />
              </button>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[12px] text-fg-muted">
            <p>{t('wf.empty')}</p>
            <button onClick={createEmptyWorkflow} className="rounded-md bg-accent-strong px-3 py-1.5 text-white hover:bg-accent">
              {t('wf.new')}
            </button>
          </div>
        )}
        <DrawerButtons left={t('drawer.nodes')} right={t('drawer.settings')} />
      </main>
      <SidePanel side="right" className="w-72 shrink-0 overflow-y-auto border-l border-line bg-panel" label="Node inspector">
        {active && <NodeInspector workflow={active} />}
      </SidePanel>
    </div>
  );
}
