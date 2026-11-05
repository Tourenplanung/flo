import { FileText, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { createPage } from '@/core/factory';
import { useT } from '@/i18n';
import { dispatch, useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { cx, IconButton } from '@/ui/common/controls';

export function PagesPanel() {
  const t = useT();
  const pages = useDocStore((s) => s.project?.pages ?? []);
  const pageId = useEditorStore((s) => s.pageId);
  const [editing, setEditing] = useState<string | null>(null);

  const add = () => {
    const page = createPage(t('page.default', { n: pages.length + 1 }));
    const res = dispatch([{ type: 'createPage', page }], { label: 'Add page' });
    if (res.ok) useEditorStore.getState().setPage(page.id);
  };

  const remove = (id: string) => {
    const idx = pages.findIndex((p) => p.id === id);
    const res = dispatch([{ type: 'deletePage', id }], { label: 'Delete page' });
    if (res.ok && id === pageId) {
      const next = pages[idx === 0 ? 1 : idx - 1];
      if (next) useEditorStore.getState().setPage(next.id);
    }
  };

  return (
    <div className="border-b border-line">
      <div className="flex h-9 items-center justify-between pl-3 pr-1.5">
        <span className="text-[11px] font-semibold">{t('left.pages')}</span>
        <IconButton label={t('left.addPage')} onClick={add} testId="add-page">
          <Plus size={14} />
        </IconButton>
      </div>
      <ul className="max-h-40 overflow-y-auto pb-1.5" data-testid="pages-list">
        {pages.map((p) => (
          <li key={p.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => useEditorStore.getState().setPage(p.id)}
              onDoubleClick={() => setEditing(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && useEditorStore.getState().setPage(p.id)}
              className={cx(
                'group mx-1.5 flex h-7 items-center gap-2 rounded px-2 text-[11px]',
                p.id === pageId ? 'bg-field text-fg' : 'text-fg-muted hover:bg-field/60 hover:text-fg',
              )}
            >
              <FileText size={13} className="shrink-0 opacity-60" />
              {editing === p.id ? (
                <input
                  autoFocus
                  defaultValue={p.name}
                  className="h-5 w-full min-w-0 rounded bg-bg px-1 text-[11px] text-fg outline-none ring-1 ring-accent"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== p.name) dispatch([{ type: 'updatePage', id: p.id, props: { name } }], { label: 'Rename page' });
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
              ) : (
                <span className="flex-1 truncate">{p.name}</span>
              )}
              {pages.length > 1 && editing !== p.id && (
                <button
                  title={t('left.deletePage')}
                  aria-label={t('left.deletePage')}
                  className="hidden text-fg-subtle hover:text-danger group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(p.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
