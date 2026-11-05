import { AlertCircle, AlertTriangle, Bot, Clock, Download, ExternalLink, Info, Play, RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import type { Workflow } from '@/core/schema';
import { FONTS } from '@/core/style';
import { getSpec, type FieldSpec, type PortValue } from '@/core/workflow/catalog';
import { unavailableReason } from '@/core/workflow/engine';
import { openInCanvas, renameNode, updateNodeParams } from '@/editor/workflowActions';
import { getActiveProvider } from '@/editor/ai';
import { useAiStore } from '@/store/aiStore';
import { useAssetUrl } from '@/editor/assetUrls';
import { useT, type MessageKey } from '@/i18n';
import { getProject, useDocStore } from '@/store/docStore';
import { useSettingsStore } from '@/store/settingsStore';
import { getCache, useWorkflowStore } from '@/store/workflowStore';
import { Checkbox, ColorField, cx, NumberField, Section, SelectField, TextField } from '@/ui/common/controls';
import { downloadText } from '@/ui/common/download';

function ParamField({ field, value, onChange }: { field: FieldSpec; value: unknown; onChange: (v: unknown, mergeKey?: string) => void }) {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const project = useDocStore((s) => s.project)!;
  const label = field.label[lang];
  const body = (() => {
    switch (field.kind) {
      case 'text':
        return <TextField testId={`wf-param-${field.key}`} value={String(value ?? '')} onChange={(v) => onChange(v)} />;
      case 'textarea':
        return (
          <textarea
            data-testid={`wf-param-${field.key}`}
            defaultValue={String(value ?? '')}
            key={String(value ?? '')}
            rows={6}
            onBlur={(e) => e.target.value !== value && onChange(e.target.value)}
            className="w-full resize-y rounded-md border border-transparent bg-field px-2 py-1.5 font-mono text-[11px] leading-4 text-fg outline-none hover:border-line-strong focus:border-accent"
          />
        );
      case 'number':
        return <NumberField label="#" testId={`wf-param-${field.key}`} value={Number(value)} min={field.min} max={field.max} step={field.step} onChange={(v) => onChange(v, field.key)} />;
      case 'color':
        return <ColorField color={String(value)} onChange={(c, _o, final) => onChange(c, final ? undefined : field.key)} testId={`wf-param-${field.key}`} />;
      case 'select':
        return <SelectField testId={`wf-param-${field.key}`} value={String(value)} options={field.options.map((o) => ({ value: o.value, label: o.label[lang] }))} onChange={(v) => onChange(v)} />;
      case 'font':
        return <SelectField value={String(value)} options={FONTS.map((f) => ({ value: f.family, label: f.family }))} onChange={(v) => onChange(v)} />;
      case 'checkbox':
        return <Checkbox label={label} checked={!!value} onChange={(v) => onChange(v)} />;
      case 'page':
        return (
          <SelectField
            testId={`wf-param-${field.key}`}
            value={String(value ?? '')}
            options={[{ value: '', label: t('wf.noPage') }, ...project.pages.map((p) => ({ value: p.id, label: p.name }))]}
            onChange={(v) => onChange(v || null)}
          />
        );
      case 'asset':
        return (
          <SelectField
            value={String(value ?? '')}
            options={[{ value: '', label: t('wf.noAsset') }, ...Object.values(project.assets).map((a) => ({ value: a.id, label: a.name }))]}
            onChange={(v) => onChange(v || null)}
          />
        );
      case 'frames':
        return null; // rendered by FramesField (needs the sibling page param)
    }
  })();
  if (field.kind === 'checkbox') return body;
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] text-fg-muted">{label}</span>
      {body}
      {field.help && <span className="text-[10.5px] leading-snug text-fg-subtle">{field.help[lang]}</span>}
    </label>
  );
}

function FramesField({ pageId, value, onChange }: { pageId: string | null; value: string[]; onChange: (v: string[]) => void }) {
  const lang = useSettingsStore((s) => s.language);
  const project = useDocStore((s) => s.project)!;
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return null;
  const frames = page.childIds.map((id) => project.nodes[id]).filter((n) => n?.type === 'frame');
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] text-fg-muted">{lang === 'it' ? 'Frame (nessuno = tutti)' : 'Frames (none = all)'}</span>
      {frames.map((f) => (
        <Checkbox
          key={f!.id}
          label={f!.name}
          checked={value.includes(f!.id)}
          onChange={(on) => onChange(on ? [...value, f!.id] : value.filter((x) => x !== f!.id))}
        />
      ))}
    </div>
  );
}

function ImageThumb({ assetId }: { assetId: string }) {
  const projectId = useDocStore((s) => s.project?.id);
  const url = useAssetUrl(projectId, assetId);
  return url ? <img src={url} alt="" className="max-h-40 w-full rounded border border-line object-contain" /> : null;
}

export function OutputPreview({ value }: { value: PortValue }) {
  const t = useT();
  switch (value.type) {
    case 'brief':
      return <p className="whitespace-pre-wrap text-[11px] leading-4 text-fg-muted">{value.text}</p>;
    case 'sitemap':
      return (
        <ul className="text-[11px] text-fg" data-testid="wf-sitemap-preview">
          {value.pages.map((p, i) => (
            <li key={i} style={{ paddingLeft: p.depth * 14 }} className="py-0.5">
              {p.depth ? '└ ' : '• '}
              {p.name}
            </li>
          ))}
        </ul>
      );
    case 'flow':
      return (
        <ol className="list-decimal pl-4 text-[11px] text-fg">
          {value.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      );
    case 'design':
      return <DesignPreview pageId={value.pageId} frameIds={value.frameIds} />;
    case 'styles':
      return (
        <div className="flex flex-col gap-2" data-testid="wf-styles-preview">
          <div className="grid grid-cols-7 gap-1">
            {Object.entries(value.colors).map(([k, c]) => (
              <div key={k} title={`${k} ${c}`} className="aspect-square rounded border border-white/10" style={{ background: c }} />
            ))}
          </div>
          <div className="text-[11px] text-fg-muted">
            {value.fonts.heading} / {value.fonts.body} · h1 {value.sizes.h1} · h2 {value.sizes.h2} · body {value.sizes.body} · r {value.radius}
          </div>
        </div>
      );
    case 'report':
      return <ReportPreview value={value} />;
    case 'image':
      return <ImageThumb assetId={value.assetId} />;
    case 'code':
      return (
        <div className="flex flex-col gap-1.5">
          {value.files.map((f) => (
            <div key={f.path} className="flex items-center gap-1.5">
              <span className="flex-1 truncate font-mono text-[11px] text-fg">{f.path}</span>
              <button
                data-testid="wf-code-preview"
                className="flex items-center gap-1 rounded bg-field px-2 py-1 text-[11px] text-fg hover:bg-field-hover"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([f.content], { type: 'text/html' }));
                  window.open(url, '_blank', 'noopener');
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }}
              >
                <ExternalLink size={11} /> {t('wf.preview')}
              </button>
              <button
                data-testid="wf-code-download"
                className="flex items-center gap-1 rounded bg-field px-2 py-1 text-[11px] text-fg hover:bg-field-hover"
                onClick={() => downloadText(f.path, f.content, 'text/html')}
              >
                <Download size={11} /> {t('wf.download')}
              </button>
            </div>
          ))}
        </div>
      );
  }
}

function DesignPreview({ pageId, frameIds }: { pageId: string; frameIds: string[] }) {
  const t = useT();
  const project = useDocStore((s) => s.project)!;
  const page = project.pages.find((p) => p.id === pageId);
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="text-[11px] text-fg">
        {frameIds.map((id) => (
          <li key={id} className={cx('truncate py-0.5', !project.nodes[id] && 'text-fg-subtle line-through')}>
            ▢ {project.nodes[id]?.name ?? id}
          </li>
        ))}
      </ul>
      <div className="text-[10.5px] text-fg-subtle">{page?.name}</div>
      <button
        data-testid="wf-open-canvas"
        className="flex items-center justify-center gap-1.5 rounded-md bg-accent-strong px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent"
        onClick={() => openInCanvas(pageId, frameIds)}
      >
        <ExternalLink size={12} /> {t('wf.openCanvas')}
      </button>
    </div>
  );
}

function ReportPreview({ value }: { value: Extract<PortValue, { type: 'report' }> }) {
  const t = useT();
  const pageOf = (id: string) => {
    const p = getProject();
    if (!p) return null;
    let cur = p.nodes[id];
    while (cur && p.nodes[cur.parentId]) cur = p.nodes[cur.parentId];
    return cur?.parentId ?? null;
  };
  const icon = { error: <AlertCircle size={12} className="text-danger" />, warning: <AlertTriangle size={12} className="text-[#F5A524]" />, info: <Info size={12} className="text-fg-subtle" /> };
  return (
    <div className="flex flex-col gap-1.5" data-testid="wf-report">
      <div className="text-[11px] font-medium text-fg">{value.title}</div>
      <div className="text-[10.5px] text-fg-subtle">
        {t('wf.checked', { n: value.checked })} · {value.issues.length ? t('wf.issues', { n: value.issues.length }) : t('wf.noIssues')}
      </div>
      <ul className="flex flex-col gap-0.5">
        {value.issues.slice(0, 100).map((i, k) => (
          <li key={k}>
            <button
              disabled={!i.nodeId}
              className="flex w-full items-start gap-1.5 rounded px-1 py-1 text-left text-[11px] leading-4 text-fg-muted enabled:hover:bg-field-hover enabled:hover:text-fg"
              onClick={() => {
                const pid = i.nodeId ? pageOf(i.nodeId) : null;
                if (pid && i.nodeId) openInCanvas(pid, [i.nodeId]);
              }}
            >
              <span className="mt-0.5 shrink-0">{icon[i.severity]}</span>
              <span>{i.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HistoryList({ workflow }: { workflow: Workflow }) {
  const t = useT();
  const history = useWorkflowStore((s) => s.history);
  const items = useMemo(() => history.filter((h) => h.workflowId === workflow.id).slice(-60).reverse(), [history, workflow.id]);
  const fmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  return (
    <Section title={t('wf.history')}>
      {items.length === 0 && <p className="text-[11px] text-fg-subtle">{t('wf.noHistory')}</p>}
      <ul className="flex flex-col" data-testid="wf-history">
        {items.map((r) => (
          <li key={r.id} className="flex items-center gap-2 border-b border-line/60 py-1 text-[11px]">
            <span className="w-14 shrink-0 tabular-nums text-fg-subtle">{fmt.format(r.startedAt)}</span>
            <button className="flex-1 truncate text-left text-fg hover:underline" onClick={() => useWorkflowStore.getState().selectNode(r.nodeId)}>
              {r.label}
            </button>
            <span className={cx('shrink-0', r.status === 'error' ? 'text-danger' : r.status === 'unavailable' ? 'text-[#F5A524]' : 'text-fg-subtle')} title={r.error ?? r.summary}>
              {t(`wf.status.${r.status}` as MessageKey)}
              {r.status === 'done' && ` · ${r.durationMs}ms`}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function NodeInspector({ workflow }: { workflow: Workflow }) {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const selectedId = useWorkflowStore((s) => s.selectedNodeId);
  const status = useWorkflowStore((s) => (selectedId ? s.statuses[selectedId] : undefined));
  const error = useWorkflowStore((s) => (selectedId ? s.errors[selectedId] : undefined));
  const running = useWorkflowStore((s) => s.running);
  useWorkflowStore((s) => s.cacheVersion);
  useAiStore((s) => s.provider + s.ollama.model + s.claude.token);
  const node = workflow.nodes.find((n) => n.id === selectedId);
  const spec = node ? getSpec(node.kind) : undefined;

  if (!node || !spec) {
    return (
      <div data-testid="wf-inspector">
        <p className="px-3 py-4 text-[11px] leading-4 text-fg-subtle">{t('wf.selectNode')}</p>
        <HistoryList workflow={workflow} />
      </div>
    );
  }

  const entry = getCache(workflow.id).get(node.id);
  const reason = unavailableReason(spec, { aiAvailable: !!getActiveProvider(), lang });
  const set = (key: string) => (v: unknown, mergeKey?: string) => updateNodeParams(workflow.id, node.id, { [key]: v }, mergeKey);
  const outputs = entry ? Object.entries(entry.outputs).filter((e): e is [string, PortValue] => !!e[1]) : [];

  return (
    <div data-testid="wf-inspector">
      <div className="border-b border-line px-3 py-3">
        <input
          key={node.id + node.label}
          defaultValue={node.label}
          aria-label={t('wf.label')}
          onBlur={(e) => e.target.value.trim() && e.target.value !== node.label && renameNode(workflow.id, node.id, e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded bg-transparent text-[12px] font-semibold text-fg outline-none focus:bg-field"
        />
        <p className="mt-1 text-[11px] leading-4 text-fg-muted">{spec.description[lang]}</p>
        {reason && (
          <p className="mt-2 flex items-start gap-1.5 rounded-md border border-[#F5A524]/30 bg-[#F5A524]/10 px-2 py-1.5 text-[11px] leading-4 text-[#F5C55B]" data-testid="wf-unavailable">
            {spec.availability === 'ai' ? <Bot size={13} className="mt-px shrink-0" /> : <Clock size={13} className="mt-px shrink-0" />}
            {reason}
          </p>
        )}
        {spec.availability === 'ready' && (
          <div className="mt-2.5 flex gap-1.5">
            <button
              data-testid="wf-run-node"
              disabled={running}
              onClick={() => void useWorkflowStore.getState().run(workflow.id, { targetId: node.id })}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent-strong px-2 py-1.5 text-[11px] font-medium text-white hover:bg-accent disabled:opacity-50"
            >
              <Play size={12} /> {t('wf.runNode')}
            </button>
            <button
              title={t('wf.rerunNode')}
              aria-label={t('wf.rerunNode')}
              disabled={running}
              onClick={() => void useWorkflowStore.getState().run(workflow.id, { targetId: node.id, force: true })}
              className="flex items-center justify-center rounded-md bg-field px-2 text-fg-muted hover:bg-field-hover hover:text-fg disabled:opacity-50"
            >
              <RotateCw size={12} />
            </button>
          </div>
        )}
        {spec.sideEffects && <p className="mt-2 text-[10.5px] leading-snug text-fg-subtle">{t('wf.regenerates')}</p>}
      </div>

      {spec.fields.length > 0 && (
        <Section title={t('wf.params')}>
          {spec.fields.map((f) =>
            f.kind === 'frames' ? (
              <FramesField key={f.key} pageId={(node.params.pageId as string | null) ?? null} value={(node.params[f.key] as string[]) ?? []} onChange={(v) => set(f.key)(v)} />
            ) : (
              <ParamField key={f.key} field={f} value={node.params[f.key]} onChange={set(f.key)} />
            ),
          )}
        </Section>
      )}

      <Section title={`${t('wf.output')}${status ? ` · ${t(`wf.status.${status}` as MessageKey)}` : ''}`}>
        {error && <p className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] leading-4 text-[#ffc9cf]" data-testid="wf-error">{error}</p>}
        {!error && outputs.length === 0 && entry?.inputs.design && node.kind === 'canvas-output' && <OutputPreview value={entry.inputs.design} />}
        {!error && outputs.length === 0 && !(node.kind === 'canvas-output' && entry) && <p className="text-[11px] text-fg-subtle">{t('wf.noOutput')}</p>}
        {outputs.map(([port, v]) => (
          <div key={port} data-testid={`wf-output-${port}`}>
            <OutputPreview value={v} />
          </div>
        ))}
      </Section>
      <HistoryList workflow={workflow} />
    </div>
  );
}
