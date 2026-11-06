import { closeDrawers, useCompact } from '@/ui/common/layout';
import {
  ChevronDown,
  Circle,
  Download,
  Frame,
  Hand,
  Image as ImageIcon,
  Keyboard,
  Maximize,
  LayoutGrid,
  Minus,
  MousePointer2,
  Play,
  Plus,
  Redo2,
  Sparkles,
  Square,
  Type,
  Undo2,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACCEPTED_IMAGE_TYPES, importAndInsertImages } from '@/editor/imageImport';
import type { SaveStatus } from '@/editor/autosave';
import { redo, undo } from '@/editor/actions';
import { useT } from '@/i18n';
import { projectRepo } from '@/persistence/projectRepo';
import { dispatch, useDocStore } from '@/store/docStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useAiStore } from '@/store/aiStore';
import { useEditorStore, useViewport, type Tool } from '@/store/editorStore';
import { cx, IconButton } from '@/ui/common/controls';
import { Logo } from '@/ui/common/Logo';
import { downloadText } from '@/ui/common/download';
import { SHORTCUTS, shortcutLabel } from './shortcuts';
import { playFromSelection } from '@/editor/prototypeActions';
import { exportHtmlFile, exportReactZip } from '@/editor/exportActions';
import { setZoom, zoomBy, zoomToFit, zoomToSelection } from './viewportActions';

const TOOLS: { tool: Tool; icon: typeof MousePointer2; key: string }[] = [
  { tool: 'select', icon: MousePointer2, key: 'V' },
  { tool: 'hand', icon: Hand, key: 'H' },
  { tool: 'frame', icon: Frame, key: 'F' },
  { tool: 'rect', icon: Square, key: 'R' },
  { tool: 'ellipse', icon: Circle, key: 'O' },
  { tool: 'line', icon: Minus, key: 'L' },
  { tool: 'text', icon: Type, key: 'T' },
];

export function TopBar({ saveStatus, onExit }: { saveStatus: SaveStatus; onExit: () => void }) {
  const t = useT();
  const tool = useEditorStore((s) => s.tool);
  const mode = useEditorStore((s) => s.mode);
  const aiOpen = useAiStore((s) => s.panelOpen);
  const project = useDocStore((s) => s.project)!;
  const canUndo = useDocStore((s) => s.past.length > 0);
  const canRedo = useDocStore((s) => s.future.length > 0);
  const imageRef = useRef<HTMLInputElement>(null);
  const compact = useCompact();

  return (
    <header className={cx('flex h-11 shrink-0 items-center border-b border-line bg-panel px-2', compact ? 'gap-0.5' : 'gap-2')} data-compact={compact || undefined}>
      <button onClick={onExit} title={`${t('top.home')} · build ${__FLO_BUILD__}`} aria-label={t('top.home')} className="flex h-8 items-center gap-1.5 rounded-md px-2 hover:bg-field-hover" data-testid="go-home">
        <Logo size={18} />
        <LayoutGrid size={13} className="text-fg-subtle" />
      </button>
      {!compact && <div className="mx-1 h-5 w-px bg-line" />}
      <nav className={cx('flex items-center gap-0.5', compact ? 'hidden' : mode === 'workflow' && 'invisible')} aria-label="Tools" data-testid="toolbar">
        {TOOLS.map(({ tool: tl, icon: Icon, key }) => (
          <IconButton
            key={tl}
            testId={`tool-${tl}`}
            label={`${t(`tool.${tl}`)} (${key})`}
            active={tool === tl}
            onClick={() => useEditorStore.getState().setTool(tl)}
            className="h-8 w-8"
          >
            <Icon size={16} />
          </IconButton>
        ))}
        <IconButton testId="tool-image" label={t('tool.image')} onClick={() => imageRef.current?.click()} className="h-8 w-8">
          <ImageIcon size={16} />
        </IconButton>
        <input
          ref={imageRef}
          type="file"
          multiple
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importAndInsertImages(files);
          }}
        />
      </nav>
      {!compact && <div className="mx-1 h-5 w-px bg-line" />}
      <IconButton label={`${t('top.undo')} (${shortcutLabel('mod+z')})`} disabled={!canUndo} onClick={undo} testId="undo">
        <Undo2 size={15} />
      </IconButton>
      <IconButton label={`${t('top.redo')} (${shortcutLabel('mod+shift+z')})`} disabled={!canRedo} onClick={redo} testId="redo">
        <Redo2 size={15} />
      </IconButton>

      {compact ? (
        <div className="flex min-w-0 flex-1 justify-center">
          <SaveIndicator status={saveStatus} dotOnly />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <ProjectName name={project.name} />
          <SaveIndicator status={saveStatus} />
        </div>
      )}

      <div className="flex rounded-md bg-field p-0.5" role="tablist" aria-label="Mode">
        {(['design', 'workflow'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            data-testid={`mode-${m}`}
            onClick={() => {
              useEditorStore.getState().setMode(m);
              closeDrawers();
            }}
            className={cx('flex h-6 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px]', mode === m ? 'bg-line-strong text-fg' : 'text-fg-muted hover:text-fg')}
          >
            {m === 'design' ? <Frame size={12} /> : <Workflow size={12} />} {!compact && t(`mode.${m}`)}
          </button>
        ))}
      </div>
      <IconButton label={`${t('proto.play')} (⇧P)`} testId="proto-play" onClick={playFromSelection}>
        <Play size={15} />
      </IconButton>
      <IconButton label={t('top.ai')} active={aiOpen} testId="ai-toggle" onClick={() => useAiStore.getState().setPanelOpen(!aiOpen)}>
        <Sparkles size={15} />
      </IconButton>
      <ExportMenu />
      {!compact && <ShortcutsButton />}
      {!compact && (mode === 'design' ? <ZoomMenu /> : <div className="w-16" />)}
    </header>
  );
}

function ExportMenu() {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const { open, setOpen, ref } = usePopover();
  const item = (testId: string, label: string, action: () => void | Promise<void>) => (
    <button
      data-testid={testId}
      className="flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] text-fg hover:bg-accent hover:text-white"
      onClick={() => {
        setOpen(false);
        void action();
      }}
    >
      {label}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <IconButton label={t('exp.title')} active={open} testId="export-menu" onClick={() => setOpen(!open)}>
        <Download size={15} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-64 rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl">
          {item('export-project', t('exp.project'), async () => {
            const live = useDocStore.getState().project ?? undefined;
            const text = await projectRepo.exportBundle(project.id, live).catch(() => null);
            if (text) downloadText(`${project.name || 'flo'}.flo.json`, text);
          })}
          {item('export-react', t('exp.react'), exportReactZip)}
          {item('export-html', t('exp.html'), exportHtmlFile)}
          <p className="px-2 pb-1 pt-1.5 text-[10.5px] leading-4 text-fg-subtle">{t('exp.scope')}</p>
        </div>
      )}
    </div>
  );
}

function ProjectName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={name}
        data-testid="project-name-input"
        className="h-7 w-56 rounded-md bg-field px-2 text-center text-[12px] text-fg outline-none ring-1 ring-accent"
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== name) dispatch([{ type: 'renameProject', name: v }], { label: 'Rename project' });
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button data-testid="project-name" className="max-w-xs truncate rounded-md px-2 py-1 text-[12px] font-medium text-fg hover:bg-field-hover" onDoubleClick={() => setEditing(true)} onClick={() => setEditing(true)}>
      {name}
    </button>
  );
}

function SaveIndicator({ status, dotOnly }: { status: SaveStatus; dotOnly?: boolean }) {
  const t = useT();
  const label = { saved: t('save.saved'), saving: t('save.saving'), unsaved: t('save.unsaved'), error: t('save.error') }[status];
  return (
    <span data-testid="save-status" data-status={status} title={label} className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
      <span className={cx('h-1.5 w-1.5 rounded-full', status === 'saved' ? 'bg-success' : status === 'error' ? 'bg-danger' : 'bg-fg-subtle')} />
      {!dotOnly && label}
    </span>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return { open, setOpen, ref };
}

function ShortcutsButton() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <IconButton label={t('shortcuts.title')} onClick={() => setOpen(!open)} active={open}>
        <Keyboard size={15} />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-72 rounded-lg border border-line-strong bg-elevated p-3 shadow-2xl">
          <h4 className="mb-2 text-[11px] font-semibold">{t('shortcuts.title')}</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            {SHORTCUTS.map((s) => (
              <div key={s.combo} className="contents">
                <dt className="font-mono text-fg-muted">{s.combo.split(' ').map((p) => (p.includes('+') ? shortcutLabel(p) : p)).join(' ')}</dt>
                <dd className="text-fg">{lang === 'it' ? s.it : s.en}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

function ZoomMenu() {
  const t = useT();
  const vp = useViewport();
  const showRulers = useEditorStore((s) => s.showRulers);
  const snapping = useEditorStore((s) => s.snapping);
  const { open, setOpen, ref } = usePopover();
  const item = (label: string, action: () => void, hint?: string) => (
    <button
      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px] text-fg hover:bg-accent hover:text-white"
      onClick={() => {
        action();
        setOpen(false);
      }}
    >
      {label}
      {hint && <span className="opacity-60">{hint}</span>}
    </button>
  );
  return (
    <div ref={ref} className="relative">
      <button data-testid="zoom-menu" onClick={() => setOpen(!open)} className="flex h-7 w-16 items-center justify-end gap-1 rounded-md px-1.5 text-[11px] tabular-nums text-fg-muted hover:bg-field-hover hover:text-fg">
        {Math.round(vp.zoom * 100)}% <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-52 rounded-lg border border-line-strong bg-elevated p-1 shadow-2xl">
          {item('Zoom +', () => zoomBy(1.25), shortcutLabel('mod++'))}
          {item('Zoom −', () => zoomBy(0.8), shortcutLabel('mod+-'))}
          {item(t('canvas.zoomFit'), zoomToFit, '⇧1')}
          {item(t('canvas.zoomSel'), zoomToSelection, '⇧2')}
          {item(t('canvas.zoom100'), () => setZoom(1), '⇧0')}
          <div className="my-1 border-t border-line" />
          {item(`${showRulers ? '✓ ' : '   '}${t('canvas.rulers')}`, () => useEditorStore.getState().toggleRulers(), '⇧R')}
          {item(`${snapping ? '✓ ' : '   '}${t('canvas.snapping')}`, () => useEditorStore.getState().toggleSnapping())}
        </div>
      )}
    </div>
  );
}

/** Vertical tool strip over the canvas on compact screens (tools + zoom), replacing the top-bar tools. */
export function CompactTools() {
  const t = useT();
  const compact = useCompact();
  const tool = useEditorStore((s) => s.tool);
  if (!compact) return null;
  const cls = 'h-9 w-9';
  return (
    <div className="absolute left-2 top-14 z-20 flex flex-col gap-0.5 rounded-xl border border-line-strong bg-elevated/95 p-1 shadow-xl backdrop-blur" data-testid="compact-tools">
      {TOOLS.map(({ tool: tl, icon: Icon }) => (
        <IconButton key={tl} testId={`ctool-${tl}`} label={t(`tool.${tl}`)} active={tool === tl} onClick={() => useEditorStore.getState().setTool(tl)} className={cls}>
          <Icon size={16} />
        </IconButton>
      ))}
      <div className="mx-1.5 my-0.5 h-px bg-line" />
      <IconButton label="Zoom +" onClick={() => zoomBy(1.25)} className={cls}>
        <Plus size={16} />
      </IconButton>
      <IconButton label="Zoom −" onClick={() => zoomBy(0.8)} className={cls}>
        <Minus size={16} />
      </IconButton>
      <IconButton label={t('canvas.zoomFit')} testId="ctool-fit" onClick={zoomToFit} className={cls}>
        <Maximize size={15} />
      </IconButton>
    </div>
  );
}
