import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Bot, Clock, Play } from 'lucide-react';
import { memo } from 'react';
import { CATEGORIES, getSpec, PORT_COLORS } from '@/core/workflow/catalog';
import { useT, type MessageKey } from '@/i18n';
import { useSettingsStore } from '@/store/settingsStore';
import { getCache, useWorkflowStore, type UiStatus } from '@/store/workflowStore';
import { cx } from '@/ui/common/controls';

export type FloNodeData = { workflowId: string; kind: string; label: string };
export type FloFlowNode = Node<FloNodeData, 'flo'>;

const STATUS_STYLE: Record<UiStatus, string> = {
  idle: 'bg-fg-subtle',
  running: 'bg-accent animate-pulse',
  done: 'bg-success',
  cached: 'bg-success/60',
  error: 'bg-danger',
  skipped: 'bg-line-strong',
  unavailable: 'bg-[#F5A524]',
  stale: 'bg-[#F5A524]',
};

export const FloNode = memo(function FloNode({ id, data, selected }: NodeProps<FloFlowNode>) {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const status = useWorkflowStore((s) => s.statuses[id] ?? 'idle');
  const error = useWorkflowStore((s) => s.errors[id]);
  const running = useWorkflowStore((s) => s.running);
  useWorkflowStore((s) => s.cacheVersion);
  const spec = getSpec(data.kind);
  if (!spec) return <div className="rounded border border-danger p-2 text-[11px]">Unknown: {data.kind}</div>;
  const cat = CATEGORIES.find((c) => c.id === spec.category)!;
  const summary = getCache(data.workflowId).get(id)?.summary;
  const rows = Math.max(spec.inputs.length, spec.outputs.length);

  return (
    <div
      data-wf-node={data.kind}
      data-status={status}
      className={cx(
        'w-56 rounded-lg border bg-elevated text-[11px] shadow-xl',
        selected ? 'border-accent ring-1 ring-accent' : 'border-line-strong',
        spec.availability !== 'ready' && 'opacity-80',
      )}
    >
      <div className="flex items-center gap-2 rounded-t-lg border-b border-line px-2.5 py-2" style={{ boxShadow: `inset 3px 0 0 ${cat.color}` }}>
        <span className={cx('h-2 w-2 shrink-0 rounded-full', STATUS_STYLE[status])} title={t(`wf.status.${status}` as MessageKey)} />
        <span className="flex-1 truncate font-semibold text-fg">{data.label || spec.label[lang]}</span>
        {spec.availability === 'ai' && (
          <span className="flex items-center gap-0.5 rounded bg-[#F5A524]/15 px-1 text-[9.5px] text-[#F5C55B]" title={t('wf.needsAI')}>
            <Bot size={10} /> AI
          </span>
        )}
        {spec.availability === 'planned' && (
          <span className="flex items-center gap-0.5 rounded bg-line px-1 text-[9.5px] text-fg-muted">
            <Clock size={10} /> {t('wf.planned')}
          </span>
        )}
        {spec.availability === 'ready' && (
          <button
            className="nodrag flex h-5 w-5 items-center justify-center rounded text-fg-subtle hover:bg-accent hover:text-white disabled:opacity-30"
            title={t('wf.runNode')}
            aria-label={t('wf.runNode')}
            data-testid="wf-node-run"
            disabled={running}
            onClick={(e) => {
              e.stopPropagation();
              void useWorkflowStore.getState().run(data.workflowId, { targetId: id });
            }}
          >
            <Play size={11} />
          </button>
        )}
      </div>
      <div className="relative py-1.5">
        {Array.from({ length: rows }).map((_, i) => {
          const inp = spec.inputs[i];
          const out = spec.outputs[i];
          return (
            <div key={i} className="relative flex h-6 items-center justify-between px-3">
              <span className="truncate text-fg-muted">
                {inp && (
                  <>
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={inp.id}
                      style={{ background: PORT_COLORS[inp.type], top: '50%', width: 9, height: 9, border: '2px solid #1b1c23' }}
                    />
                    {inp.label[lang]}
                    {inp.optional && <span className="text-fg-subtle"> ?</span>}
                  </>
                )}
              </span>
              <span className="truncate text-right text-fg-muted">
                {out && (
                  <>
                    {out.label[lang]}
                    <Handle
                      type="source"
                      position={Position.Right}
                      id={out.id}
                      style={{ background: PORT_COLORS[out.type], top: '50%', width: 9, height: 9, border: '2px solid #1b1c23' }}
                    />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {(summary || error) && (
        <div className={cx('truncate border-t border-line px-2.5 py-1.5', error ? 'text-[#ffb3bb]' : 'text-fg-subtle')} title={error ?? summary}>
          {error ?? summary}
        </div>
      )}
    </div>
  );
});
