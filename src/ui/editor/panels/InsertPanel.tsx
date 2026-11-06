import { Circle, Frame, Github, Image as ImageIcon, Minus, Square, Type } from 'lucide-react';
import type { ReactNode } from 'react';
import { createEllipse, createIcon, createImage, createLine, createPreset, createRect, createText, FRAME_PRESETS, UI_PRESETS, type NodeTree, type UIPreset } from '@/core/factory';
import { ICON_NAMES, type DesignNode, type IconName } from '@/core/schema';
import { insertTree, resolveInsertTarget } from '@/editor/actions';
import { closeDrawers } from '@/ui/common/layout';
import { useT, type MessageKey } from '@/i18n';
import { githubComponents, insertGithubCopy } from '@/editor/githubImport';
import { getProject, useDocStore } from '@/store/docStore';
import { useGithubImport } from '../GithubImportDialog';
import { DESIGN_ICONS } from '@/ui/common/icons';
import { addFramePreset } from '../inspector/Inspector';

function single(node: DesignNode): NodeTree {
  return { root: node, nodes: [node] };
}

function insertInto(make: (parentId: string) => NodeTree, label: string) {
  const project = getProject();
  if (!project) return;
  const parentId = resolveInsertTarget(project);
  insertTree(make(parentId), parentId, undefined, label);
  closeDrawers();
}

function Tile({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex h-16 flex-col items-center justify-center gap-1.5 rounded-md border border-line bg-field/40 text-[10.5px] text-fg-muted hover:border-line-strong hover:bg-field hover:text-fg"
    >
      {children}
      <span className="max-w-full truncate px-1">{label}</span>
    </button>
  );
}

const PRESET_PREVIEW: Record<UIPreset, ReactNode> = {
  button: <span className="rounded bg-accent-strong px-2 py-0.5 text-[9px] text-white">Button</span>,
  input: <span className="w-14 rounded border border-fg-subtle px-1 text-left text-[8px] text-fg-subtle">Input…</span>,
  card: (
    <span className="flex h-6 w-9 flex-col gap-0.5 rounded-sm border border-fg-subtle p-0.5">
      <span className="h-2 rounded-[1px] bg-fg-subtle/60" />
      <span className="h-0.5 w-5 bg-fg-subtle" />
    </span>
  ),
  navbar: (
    <span className="flex w-14 items-center justify-between rounded-sm border border-fg-subtle px-1 py-0.5">
      <span className="h-1 w-3 bg-fg-muted" />
      <span className="flex gap-0.5">
        <span className="h-0.5 w-1.5 bg-fg-subtle" />
        <span className="h-0.5 w-1.5 bg-fg-subtle" />
        <span className="h-0.5 w-1.5 bg-fg-subtle" />
      </span>
    </span>
  ),
  section: (
    <span className="flex w-14 flex-col items-center gap-0.5 rounded-sm border border-fg-subtle py-1">
      <span className="h-1 w-8 bg-fg-muted" />
      <span className="h-0.5 w-6 bg-fg-subtle" />
      <span className="h-1.5 w-4 rounded-[1px] bg-accent-strong" />
    </span>
  ),
  container: <span className="h-6 w-9 rounded border border-dashed border-fg-subtle" />,
};

export function InsertPanel() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 p-3" data-testid="insert-panel">
      <p className="text-[10.5px] leading-4 text-fg-subtle">{t('insert.hint')}</p>
      <section>
        <h3 className="mb-2 text-[11px] font-semibold">{t('insert.frames')}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {FRAME_PRESETS.slice(0, 6).map((p) => (
            <Tile key={p.id} testId={`insert-frame-${p.id}`} label={`${p.name} · ${p.width}×${p.height}`} onClick={() => {
              addFramePreset(p.width, p.height, p.name);
              closeDrawers();
            }}>
              <Frame size={16} />
            </Tile>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[11px] font-semibold">{t('insert.shapes')}</h3>
        <div className="grid grid-cols-5 gap-1.5">
          <Tile testId="insert-rect" label={t('tool.rect')} onClick={() => insertInto((p) => single(createRect({ parentId: p, width: 160, height: 100 })), 'Insert rectangle')}>
            <Square size={16} />
          </Tile>
          <Tile testId="insert-ellipse" label={t('tool.ellipse')} onClick={() => insertInto((p) => single(createEllipse({ parentId: p, width: 100, height: 100 })), 'Insert ellipse')}>
            <Circle size={16} />
          </Tile>
          <Tile testId="insert-line" label={t('tool.line')} onClick={() => insertInto((p) => single(createLine({ parentId: p, width: 160, height: 0 })), 'Insert line')}>
            <Minus size={16} />
          </Tile>
          <Tile testId="insert-text" label={t('tool.text')} onClick={() => insertInto((p) => single(createText({ parentId: p }, { characters: t('tool.text') })), 'Insert text')}>
            <Type size={16} />
          </Tile>
          <Tile testId="insert-image" label={t('tool.image')} onClick={() => insertInto((p) => single(createImage({ parentId: p, width: 480, height: 320 })), 'Insert image')}>
            <ImageIcon size={16} />
          </Tile>
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-[11px] font-semibold">{t('insert.ui')}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {UI_PRESETS.map((k) => (
            <Tile key={k} testId={`insert-${k}`} label={t(`preset.${k}` as MessageKey)} onClick={() => insertInto((p) => createPreset(k, p, 0, 0), `Insert ${k}`)}>
              {PRESET_PREVIEW[k]}
            </Tile>
          ))}
        </div>
      </section>
      <GithubSection />
      <section>
        <h3 className="mb-2 text-[11px] font-semibold">{t('insert.icons')}</h3>
        <div className="grid grid-cols-8 gap-1">
          {ICON_NAMES.map((name: IconName) => {
            const Icon = DESIGN_ICONS[name];
            return (
              <button
                key={name}
                title={name}
                aria-label={name}
                className="flex h-7 items-center justify-center rounded text-fg-muted hover:bg-field-hover hover:text-fg"
                onClick={() => insertInto((p) => single(createIcon({ parentId: p }, name)), 'Insert icon')}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function GithubSection() {
  const t = useT();
  const project = useDocStore((s) => s.project);
  const groups = project ? githubComponents(project) : [];
  return (
    <section data-testid="insert-github">
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold">
        <Github size={12} /> {t('gh.section')}
      </h3>
      {!groups.length && <p className="mb-2 text-[10.5px] leading-4 text-fg-subtle">{t('gh.empty')}</p>}
      {groups.map((g) => (
        <div key={`${g.repo}::${g.set}`} className="mb-2">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[10.5px]">
            <span className="truncate text-fg-muted">{g.set}</span>
            <span className="truncate text-fg-subtle">{g.repo}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {g.items.map((c) => {
              const variant = Object.values(c.component?.variant ?? {}).join(' · ');
              return (
                <Tile key={c.id} testId={`insert-gh-${c.name}`} label={variant || g.set} onClick={() => insertGithubCopy(c.id)}>
                  <span title={t('gh.insertCopy')} className="flex h-5 items-center rounded border border-fg-subtle px-1.5 text-[8px] text-fg-subtle">
                    {'</>'}
                  </span>
                </Tile>
              );
            })}
          </div>
        </div>
      ))}
      <button
        type="button"
        data-testid="gh-open"
        onClick={() => useGithubImport.getState().setOpen(true)}
        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong text-[11px] text-fg-muted hover:border-accent hover:text-fg"
      >
        <Github size={13} /> {t('gh.open')}
      </button>
    </section>
  );
}
