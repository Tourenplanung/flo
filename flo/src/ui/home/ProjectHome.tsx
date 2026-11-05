import { Copy, Download, FolderOpen, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { projectRepo, type ProjectSummary } from '@/persistence/projectRepo';
import { useSettingsStore } from '@/store/settingsStore';
import { Logo } from '@/ui/common/Logo';
import { downloadText } from '@/ui/common/download';

export function ProjectHome({ onOpen }: { onOpen: (id: string) => void }) {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => projectRepo.list().then(setProjects), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    const p = await projectRepo.create(t('home.untitled'), t('page.default', { n: 1 }));
    onOpen(p.id);
  };

  const importFile = async (file: File) => {
    try {
      const p = await projectRepo.importBundle(await file.text());
      setMessage({ text: t('home.imported'), tone: 'info' });
      await refresh();
      onOpen(p.id);
    } catch (e) {
      setMessage({ text: t('home.importError', { error: e instanceof Error ? e.message : String(e) }), tone: 'error' });
    }
  };

  const fmt = new Intl.DateTimeFormat(lang === 'it' ? 'it-IT' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="h-full overflow-y-auto bg-bg" data-testid="home">
      <header className="flex h-14 items-center justify-between border-b border-line px-6">
        <div className="flex items-center gap-3">
          <Logo size={24} />
          <span className="text-[12px] text-fg-subtle">{t('app.tagline')}</span>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-fg-muted">
          {t('lang.label')}
          <select
            data-testid="language"
            value={lang}
            onChange={(e) => setLanguage(e.target.value as 'it' | 'en')}
            className="h-7 rounded-md bg-field px-2 text-fg outline-none"
          >
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('home.title')}</h1>
            <p className="mt-1 text-[13px] text-fg-muted">{t('home.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3 text-[13px] text-fg hover:bg-field"
            >
              <Upload size={15} /> {t('home.import')}
            </button>
            <button
              data-testid="new-project"
              onClick={create}
              className="flex h-9 items-center gap-2 rounded-lg bg-accent-strong px-3.5 text-[13px] font-medium text-white hover:bg-accent"
            >
              <Plus size={15} /> {t('home.new')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.flo.json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void importFile(f);
              }}
            />
          </div>
        </div>
        {message && (
          <p className={`mb-6 rounded-lg border px-3 py-2 text-[12px] ${message.tone === 'error' ? 'border-danger/40 text-[#ffc9cf]' : 'border-line text-fg-muted'}`}>
            {message.text}
          </p>
        )}
        {projects && projects.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-line-strong py-20 text-center">
            <p className="text-[13px] text-fg-muted">{t('home.empty')}</p>
            <button onClick={create} className="flex h-9 items-center gap-2 rounded-lg bg-accent-strong px-3.5 text-[13px] font-medium text-white hover:bg-accent">
              <Plus size={15} /> {t('home.new')}
            </button>
          </div>
        )}
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="project-list">
          {projects?.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              updated={t('home.updated', { date: fmt.format(p.updatedAt) })}
              onOpen={() => onOpen(p.id)}
              onChanged={refresh}
            />
          ))}
        </ul>
        <p className="mt-12 text-[11px] text-fg-subtle">{t('home.localNote')}</p>
      </main>
    </div>
  );
}

function ProjectCard({ project, updated, onOpen, onChanged }: { project: ProjectSummary; updated: string; onOpen: () => void; onChanged: () => void }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const act = (fn: () => Promise<unknown> | void) => async () => {
    setMenu(false);
    await fn();
    onChanged();
  };

  return (
    <li ref={ref} className="group relative" data-testid="project-card">
      <button onClick={onOpen} className="block w-full overflow-hidden rounded-xl border border-line bg-panel text-left transition-colors hover:border-line-strong">
        <div className="flex aspect-[16/10] items-center justify-center bg-canvas">
          <span className="text-4xl font-semibold text-line-strong">{project.name.slice(0, 1).toUpperCase()}</span>
        </div>
        <div className="px-3 py-2.5">
          {renaming ? (
            <input
              autoFocus
              defaultValue={project.name}
              data-testid="rename-input"
              onClick={(e) => e.stopPropagation()}
              className="h-6 w-full rounded bg-field px-1.5 text-[13px] text-fg outline-none ring-1 ring-accent"
              onBlur={async (e) => {
                const v = e.target.value.trim();
                setRenaming(false);
                if (v && v !== project.name) {
                  await projectRepo.rename(project.id, v);
                  onChanged();
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <div className="truncate text-[13px] font-medium text-fg" data-testid="project-card-name">
              {project.name}
            </div>
          )}
          <div className="mt-0.5 text-[11px] text-fg-subtle">{updated}</div>
        </div>
      </button>
      <button
        aria-label="Menu"
        data-testid="project-menu"
        onClick={() => setMenu(!menu)}
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-fg opacity-0 backdrop-blur group-hover:opacity-100 focus:opacity-100"
      >
        <MoreHorizontal size={15} />
      </button>
      {menu && (
        <div className="absolute right-2 top-10 z-20 w-52 rounded-lg border border-line-strong bg-elevated p-1 text-[12px] shadow-2xl" role="menu">
          <MenuItem icon={<FolderOpen size={13} />} label={t('home.open')} onClick={onOpen} />
          <MenuItem icon={<Pencil size={13} />} label={t('home.rename')} onClick={() => (setMenu(false), setRenaming(true))} />
          <MenuItem icon={<Copy size={13} />} label={t('home.duplicate')} onClick={act(() => projectRepo.duplicate(project.id, t('home.copySuffix')))} />
          <MenuItem
            icon={<Download size={13} />}
            label={t('home.export')}
            onClick={act(async () => downloadText(`${project.name}.flo.json`, await projectRepo.exportBundle(project.id)))}
          />
          <div className="my-1 border-t border-line" />
          <MenuItem
            danger
            icon={<Trash2 size={13} />}
            label={t('home.delete')}
            onClick={act(async () => {
              if (window.confirm(t('home.confirmDelete', { name: project.name }))) await projectRepo.remove(project.id);
            })}
          />
        </div>
      )}
    </li>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${danger ? 'text-danger hover:bg-danger hover:text-white' : 'text-fg hover:bg-accent hover:text-white'}`}
    >
      {icon}
      {label}
    </button>
  );
}
