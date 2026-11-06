import { useCompact } from '@/ui/common/layout';
import { AlertTriangle, Check, Loader2, Settings2, Sparkles, Square, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { runDesignAgent } from '@/core/ai/agent';
import { AiError, estimateCost, type AiProvider } from '@/core/ai/provider';
import { topLevelOnly } from '@/core/tree';
import { generateWithConsent, getActiveProvider } from '@/editor/ai';
import { useT } from '@/i18n';
import { dispatch, getProject, useDocStore } from '@/store/docStore';
import { useAiStore } from '@/store/aiStore';
import { useEditorStore } from '@/store/editorStore';
import type { HistoryEntry } from '@/store/history';
import { cx, IconButton } from '@/ui/common/controls';
import { zoomToSelection } from '@/ui/editor/viewportActions';

type Status = 'running' | 'pending' | 'accepted' | 'rejected' | 'error';

interface Turn {
  id: number;
  request: string;
  status: Status;
  summary?: string;
  error?: string;
  counts?: { c: number; u: number; d: number };
  skipped?: string[];
  usage?: { inputTokens: number; outputTokens: number };
  model?: string;
  cost?: number | null;
  entry?: HistoryEntry;
}

const EXAMPLES = [
  'Crea una dashboard SaaS per un servizio di concierge automobilistico',
  'Genera una schermata di login moderna, desktop 1440',
  'Rendi questa interfaccia più minimale mantenendo l’identità del brand',
  'Migliora accessibilità e contrasto della selezione',
];

/** Provider wrapper that asks for consent (billable calls) before each request. */
function consentProvider(base: AiProvider): AiProvider {
  return { ...base, generate: (req, signal) => generateWithConsent(req, 'Assistente di design', signal) };
}

let turnSeq = 0;

export function AssistantPanel() {
  const compact = useCompact();
  const t = useT();
  const open = useAiStore((s) => s.panelOpen);
  const providerId = useAiStore((s) => s.provider);
  useAiStore((s) => s.ollama.model + s.claude.token);
  const selection = useEditorStore((s) => s.selection);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [scope, setScope] = useState<'selection' | 'page'>('selection');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);
  if (!open) return null;
  const provider = getActiveProvider();
  const running = turns.some((x) => x.status === 'running');
  const update = (id: number, patch: Partial<Turn>) => setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const send = async () => {
    const project = getProject();
    const s = useEditorStore.getState();
    const request = text.trim();
    if (!project || !s.pageId || !request || !provider) return;
    const page = project.pages.find((p) => p.id === s.pageId)!;
    const selected = topLevelOnly(project, s.selection.filter((id) => project.nodes[id]));
    const useSelection = scope === 'selection' && selected.length > 0;
    const single = useSelection && selected.length === 1 ? project.nodes[selected[0]!] : undefined;
    const targetId = single?.type === 'frame' ? single.id : page.id;
    const contextIds = useSelection ? selected : page.childIds;
    const id = ++turnSeq;
    setTurns((ts) => [...ts, { id, request, status: 'running' }]);
    setText('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const out = await runDesignAgent(consentProvider(provider), project, { targetId, contextIds }, request, controller.signal);
      // Apply as one undoable, labelled transaction: the preview the user accepts or rejects.
      const res = dispatch(out.result.ops, { label: `AI · ${out.plan.summary.slice(0, 60) || request.slice(0, 60)}` });
      if (!res.ok) throw new AiError(res.error, 'invalid_output');
      const entry = useDocStore.getState().past.at(-1);
      const touched = [...out.result.createdRoots, ...out.result.updatedIds].filter((nid) => res.project.nodes[nid]);
      if (touched.length) {
        useEditorStore.getState().select(touched);
        requestAnimationFrame(() => requestAnimationFrame(() => zoomToSelection()));
      }
      update(id, {
        status: 'pending',
        summary: out.plan.summary,
        counts: { c: out.result.createdRoots.length, u: out.result.updatedIds.length, d: out.result.deletedIds.length },
        skipped: out.result.errors,
        usage: out.generation.usage,
        model: out.generation.model,
        cost: out.generation.usage ? estimateCost(out.generation.model, out.generation.usage) : null,
        entry,
      });
    } catch (e) {
      update(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
    } finally {
      abortRef.current = null;
    }
  };

  const reject = (turn: Turn) => {
    const past = useDocStore.getState().past;
    if (turn.entry && past.at(-1) === turn.entry) {
      useDocStore.getState().undo();
      update(turn.id, { status: 'rejected' });
    } else useEditorStore.getState().showToast(t('ai.cantReject'), 'error');
  };

  return (
    <aside
      className={compact ? 'absolute inset-y-0 right-0 z-40 flex w-[min(360px,92vw)] flex-col border-l border-line bg-panel shadow-2xl' : 'flex w-80 shrink-0 flex-col border-l border-line bg-panel'}
      data-testid="ai-panel"
      aria-label={t('ai.title')}
    >
      <div className="flex h-10 items-center justify-between border-b border-line pl-3 pr-1.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold">
          <Sparkles size={14} className="text-accent" /> {t('ai.title')}
        </span>
        <div className="flex">
          <IconButton label={t('ai.settings')} onClick={() => useAiStore.getState().setSettingsOpen(true)} testId="ai-open-settings">
            <Settings2 size={14} />
          </IconButton>
          <IconButton label="Close" onClick={() => useAiStore.getState().setPanelOpen(false)}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {!provider ? (
        <div className="flex flex-col gap-3 p-3 text-[12px] leading-5 text-fg-muted" data-testid="ai-not-configured">
          <p>{t('ai.notConfigured')}</p>
          <button className="h-8 rounded-md bg-accent-strong text-white hover:bg-accent" onClick={() => useAiStore.getState().setSettingsOpen(true)}>
            {t('ai.configure')}
          </button>
        </div>
      ) : (
        <>
          <div className="border-b border-line px-3 py-1.5 text-[10.5px] text-fg-subtle">
            {providerId === 'claude' ? 'Claude' : 'Ollama'} · {useAiStore.getState()[providerId === 'claude' ? 'claude' : 'ollama'].model}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-testid="ai-turns">
            {turns.length === 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-fg-subtle">{t('ai.examples')}</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => setText(ex)} className="rounded-md border border-line px-2 py-1.5 text-left text-[11px] text-fg-muted hover:border-line-strong hover:text-fg">
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {turns.map((turn) => (
              <div key={turn.id} className="flex flex-col gap-1.5" data-testid="ai-turn" data-status={turn.status}>
                <div className="self-end rounded-lg bg-accent/20 px-2.5 py-1.5 text-[12px] text-fg">{turn.request}</div>
                {turn.status === 'running' && (
                  <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                    <Loader2 size={13} className="animate-spin" /> {t('ai.thinking')}
                  </div>
                )}
                {turn.status === 'error' && (
                  <div className="flex gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px] leading-4 text-[#ffc9cf]" data-testid="ai-error">
                    <AlertTriangle size={13} className="mt-px shrink-0" />
                    {turn.error}
                  </div>
                )}
                {turn.summary !== undefined && (
                  <div className="rounded-lg border border-line bg-elevated px-2.5 py-2 text-[12px] leading-5">
                    <p className="text-fg" data-testid="ai-summary">{turn.summary}</p>
                    {turn.counts && <p className="mt-1 text-[11px] text-fg-muted">{t('ai.changes', turn.counts)}</p>}
                    {!!turn.skipped?.length && (
                      <details className="mt-1 text-[11px] text-[#F5C55B]">
                        <summary>{t('ai.skipped', { n: turn.skipped.length })}</summary>
                        <ul className="mt-1 list-disc pl-4 text-fg-subtle">
                          {turn.skipped.slice(0, 10).map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {turn.usage && (
                      <p className="mt-1 text-[10.5px] text-fg-subtle" data-testid="ai-usage">
                        {turn.model} · {t('ai.usage', { i: turn.usage.inputTokens, o: turn.usage.outputTokens })}
                        {turn.cost != null && ` · ${t('ai.cost', { c: turn.cost.toFixed(3) })}`}
                      </p>
                    )}
                    {turn.status === 'pending' && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        <span className="text-[10.5px] text-fg-subtle">{t('ai.pending')}</span>
                        <div className="flex gap-1.5">
                          <button data-testid="ai-accept" className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-accent-strong text-[11px] font-medium text-white hover:bg-accent" onClick={() => update(turn.id, { status: 'accepted' })}>
                            <Check size={12} /> {t('ai.accept')}
                          </button>
                          <button data-testid="ai-reject" className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-field text-[11px] text-fg hover:bg-field-hover" onClick={() => reject(turn)}>
                            <Undo2 size={12} /> {t('ai.reject')}
                          </button>
                        </div>
                      </div>
                    )}
                    {(turn.status === 'accepted' || turn.status === 'rejected') && (
                      <p className={cx('mt-1 text-[11px]', turn.status === 'accepted' ? 'text-success' : 'text-fg-subtle')}>{t(turn.status === 'accepted' ? 'ai.accepted' : 'ai.rejected')}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="border-t border-line p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-fg-subtle">
              {t('ai.scope')}:
              {(['selection', 'page'] as const).map((sc) => (
                <button
                  key={sc}
                  onClick={() => setScope(sc)}
                  className={cx('rounded px-1.5 py-0.5', scope === sc ? 'bg-field text-fg' : 'hover:text-fg')}
                  data-testid={`ai-scope-${sc}`}
                >
                  {t(sc === 'selection' ? 'ai.scopeSelection' : 'ai.scopePage')}
                  {sc === 'selection' && selection.length > 0 && ` (${selection.length})`}
                </button>
              ))}
            </div>
            <textarea
              data-testid="ai-input"
              value={text}
              rows={3}
              placeholder={t('ai.placeholder')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
              }}
              className="w-full resize-none rounded-md border border-transparent bg-field px-2 py-1.5 text-[12px] leading-5 text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
            />
            <div className="mt-2 flex justify-end">
              {running ? (
                <button data-testid="ai-cancel" onClick={() => abortRef.current?.abort()} className="flex h-8 items-center gap-1.5 rounded-md bg-field px-3 text-[12px] text-fg hover:bg-field-hover">
                  <Square size={11} /> {t('ai.cancel')}
                </button>
              ) : (
                <button data-testid="ai-send" disabled={!text.trim()} onClick={() => void send()} className="flex h-8 items-center gap-1.5 rounded-md bg-accent-strong px-3 text-[12px] font-medium text-white hover:bg-accent disabled:opacity-40">
                  <Sparkles size={12} /> {t('ai.send')}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
