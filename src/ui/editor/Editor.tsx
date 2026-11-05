import { lazy, Suspense, useEffect, useState } from 'react';
import { clearAssetUrls } from '@/editor/assetUrls';
import { useAutosave } from '@/editor/autosave';
import { useT } from '@/i18n';
import { projectRepo } from '@/persistence/projectRepo';
import { useDocStore } from '@/store/docStore';
import { useEditorStore, type LeftTab } from '@/store/editorStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { cx } from '@/ui/common/controls';
import { Toast } from '@/ui/common/Toast';
import { Canvas } from './canvas/Canvas';
import { Inspector } from './inspector/Inspector';
import { AssetsPanel } from './panels/AssetsPanel';
import { InsertPanel } from './panels/InsertPanel';
import { LayersPanel } from './panels/LayersPanel';
import { PagesPanel } from './panels/PagesPanel';
import { useEditorShortcuts } from './shortcuts';
import { TopBar } from './TopBar';
import { zoomToFit } from './viewportActions';

/** The workflow canvas (React Flow) is loaded on demand to keep the initial bundle small. */
const WorkflowView = lazy(() => import('@/ui/workflow/WorkflowView').then((m) => ({ default: m.WorkflowView })));

export function Editor({ projectId, onExit }: { projectId: string; onExit: () => void }) {
  const t = useT();
  const project = useDocStore((s) => s.project);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    projectRepo
      .load(projectId)
      .then((p) => {
        if (!alive) return;
        if (!p) return setError(t('error.notFound'));
        useDocStore.getState().load(p);
        useEditorStore.getState().reset(p.pages[0]!.id);
        void useWorkflowStore.getState().init(p.id);
        // Fit content once it has been rendered and measured.
        requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
      })
      .catch((e: unknown) => alive && setError(t('error.load', { error: e instanceof Error ? e.message : String(e) })));
    return () => {
      alive = false;
      useDocStore.getState().close();
      clearAssetUrls();
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-sm">
        <p className="text-fg-muted">{error}</p>
        <button className="rounded-md bg-field px-3 py-1.5 hover:bg-field-hover" onClick={onExit}>
          {t('top.home')}
        </button>
      </div>
    );
  }
  if (!project || project.id !== projectId) return <div className="h-full bg-bg" />;
  return <EditorShell onExit={onExit} />;
}

function EditorShell({ onExit }: { onExit: () => void }) {
  const t = useT();
  const { status, saveNow } = useAutosave();
  useEditorShortcuts(saveNow);
  const leftTab = useEditorStore((s) => s.leftTab);
  const mode = useEditorStore((s) => s.mode);
  const tabs: { id: LeftTab; label: string }[] = [
    { id: 'layers', label: t('left.layers') },
    { id: 'insert', label: t('left.insert') },
    { id: 'assets', label: t('left.assets') },
  ];

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="editor">
      <TopBar saveStatus={status} onExit={() => {
        saveNow();
        onExit();
      }} />
      {mode === 'workflow' ? (
        <Suspense fallback={<div className="flex-1 bg-canvas" />}>
          <WorkflowView />
        </Suspense>
      ) : (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel" aria-label="Pannello sinistro">
          <PagesPanel />
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={leftTab === tab.id}
                data-testid={`tab-${tab.id}`}
                onClick={() => useEditorStore.getState().setLeftTab(tab.id)}
                className={cx(
                  'h-6 rounded px-2 text-[11px]',
                  leftTab === tab.id ? 'bg-field font-semibold text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {leftTab === 'layers' && <LayersPanel />}
            {leftTab === 'insert' && <InsertPanel />}
            {leftTab === 'assets' && <AssetsPanel />}
          </div>
        </aside>
        <main className="relative min-w-0 flex-1">
          <Canvas />
        </main>
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-line bg-panel" aria-label="Inspector">
          <Inspector />
        </aside>
      </div>
      )}
      <Toast />
    </div>
  );
}
