import { closeDrawers, SidePanel } from '@/ui/common/layout';
import { Bot, Clock, Copy, LayoutTemplate, Plus, Save, Trash2, Workflow as WorkflowIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATEGORIES, NODE_SPECS } from '@/core/workflow/catalog';
import {
  addNode,
  BUILTIN_TEMPLATES,
  createEmptyWorkflow,
  createFromTemplate,
  createFromUserTemplate,
  deleteWorkflow,
  duplicateWorkflow,
  renameWorkflow,
  saveAsTemplate,
} from '@/editor/workflowActions';
import { useT } from '@/i18n';
import { workflowRepo, type StoredTemplate } from '@/persistence/workflowRepo';
import { useDocStore } from '@/store/docStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useWorkflowStore } from '@/store/workflowStore';
import { cx, IconButton } from '@/ui/common/controls';
import { PALETTE_MIME } from './FlowCanvas';

function TemplatesMenu({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const [mine, setMine] = useState<StoredTemplate[]>([]);
  useEffect(() => {
    void workflowRepo.listTemplates().then(setMine);
  }, []);
  return (
    <div className="mx-2 mb-2 rounded-lg border border-line-strong bg-elevated p-1.5 shadow-xl" data-testid="wf-templates">
      <div className="px-1.5 pb-1 pt-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">{t('wf.templates')}</div>
      {BUILTIN_TEMPLATES.map((tpl) => (
        <button
          key={tpl.id}
          data-testid={`wf-template-${tpl.id}`}
          className="block w-full rounded px-1.5 py-1.5 text-left hover:bg-field-hover"
          onClick={() => {
            createFromTemplate(tpl);
            onClose();
            closeDrawers();
          }}
        >
          <div className="text-[11px] font-medium text-fg">{tpl.name[lang]}</div>
          <div className="text-[10.5px] leading-snug text-fg-subtle">{tpl.description[lang]}</div>
        </button>
      ))}
      {mine.length > 0 && (
        <>
          <div className="mt-1 border-t border-line px-1.5 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">{t('wf.myTemplates')}</div>
          {mine.map((tpl) => (
            <div key={tpl.id} className="group flex items-center rounded hover:bg-field-hover">
              <button
                className="flex-1 truncate px-1.5 py-1.5 text-left text-[11px] text-fg"
                onClick={() => {
                  void createFromUserTemplate(tpl.id);
                  onClose();
                }}
              >
                {tpl.name}
              </button>
              <button
                className="hidden px-1.5 text-fg-subtle hover:text-danger group-hover:block"
                aria-label="Delete template"
                onClick={async () => {
                  await workflowRepo.deleteTemplate(tpl.id);
                  setMine(await workflowRepo.listTemplates());
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export function WorkflowSidebar() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const workflows = useDocStore((s) => s.project?.workflows ?? []);
  const activeId = useWorkflowStore((s) => s.activeId);
  const [showTemplates, setShowTemplates] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const active = workflows.find((w) => w.id === activeId);

  return (
    <SidePanel side="left" className="flex w-60 shrink-0 flex-col border-r border-line bg-panel" label={t('wf.workflows')}>
      <div className="border-b border-line">
        <div className="flex h-9 items-center justify-between pl-3 pr-1.5">
          <span className="text-[11px] font-semibold">{t('wf.workflows')}</span>
          <div className="flex">
            <IconButton label={t('wf.fromTemplate')} active={showTemplates} onClick={() => setShowTemplates(!showTemplates)} testId="wf-from-template">
              <LayoutTemplate size={14} />
            </IconButton>
            <IconButton label={t('wf.new')} onClick={createEmptyWorkflow} testId="wf-new">
              <Plus size={14} />
            </IconButton>
          </div>
        </div>
        {showTemplates && <TemplatesMenu onClose={() => setShowTemplates(false)} />}
        {workflows.length === 0 && !showTemplates && <p className="px-3 pb-3 text-[11px] leading-4 text-fg-subtle">{t('wf.empty')}</p>}
        <ul className="max-h-48 overflow-y-auto pb-1.5" data-testid="wf-list">
          {workflows.map((w) => (
            <li key={w.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => useWorkflowStore.getState().setActive(w.id)}
                onDoubleClick={() => setRenaming(w.id)}
                className={cx('group mx-1.5 flex h-7 items-center gap-2 rounded px-2 text-[11px]', w.id === activeId ? 'bg-field text-fg' : 'text-fg-muted hover:bg-field/60 hover:text-fg')}
              >
                <WorkflowIcon size={13} className="shrink-0 opacity-60" />
                {renaming === w.id ? (
                  <input
                    autoFocus
                    defaultValue={w.name}
                    className="h-5 w-full min-w-0 rounded bg-bg px-1 text-[11px] text-fg outline-none ring-1 ring-accent"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== w.name) renameWorkflow(w.id, v);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="flex-1 truncate">{w.name}</span>
                )}
                <span className="text-[10px] text-fg-subtle">{w.nodes.length}</span>
              </div>
            </li>
          ))}
        </ul>
        {active && (
          <div className="flex items-center justify-end gap-0.5 border-t border-line px-1.5 py-1">
            <IconButton label={t('wf.duplicate')} onClick={() => duplicateWorkflow(active.id)} testId="wf-duplicate">
              <Copy size={13} />
            </IconButton>
            <IconButton label={t('wf.saveTemplate')} onClick={() => void saveAsTemplate(active.id)} testId="wf-save-template">
              <Save size={13} />
            </IconButton>
            <IconButton label={t('wf.delete')} onClick={() => deleteWorkflow(active.id)} testId="wf-delete">
              <Trash2 size={13} />
            </IconButton>
          </div>
        )}
      </div>

      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] font-semibold">{t('wf.nodes')}</span>
        <span className="text-[10px] text-fg-subtle">{t('wf.dragHint')}</span>
      </div>
      <div className={cx('min-h-0 flex-1 overflow-y-auto px-2 py-2', !active && 'pointer-events-none opacity-40')} data-testid="wf-palette">
        {CATEGORIES.map((cat) => (
          <section key={cat.id} className="mb-3">
            <h4 className="mb-1 flex items-center gap-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
              {cat.label[lang]}
            </h4>
            {NODE_SPECS.filter((s) => s.category === cat.id).map((s) => (
              <button
                key={s.kind}
                draggable
                data-testid={`wf-add-${s.kind}`}
                title={s.description[lang]}
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_MIME, s.kind);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => {
                  if (!active) return;
                  const n = active.nodes.length;
                  const maxX = active.nodes.reduce((m, x) => Math.max(m, x.position.x), -320);
                  addNode(active.id, s.kind, { x: maxX + 300, y: 80 + (n % 3) * 40 });
                  closeDrawers();
                }}
                className="flex h-7 w-full items-center gap-2 rounded px-1.5 text-left text-[11px] text-fg-muted hover:bg-field-hover hover:text-fg"
              >
                <span className="flex-1 truncate">{s.label[lang]}</span>
                {s.availability === 'ai' && <Bot size={11} className="text-[#F5C55B]" aria-label={t('wf.needsAI')} />}
                {s.availability === 'planned' && <Clock size={11} className="text-fg-subtle" aria-label={t('wf.planned')} />}
              </button>
            ))}
          </section>
        ))}
      </div>
    </SidePanel>
  );
}
