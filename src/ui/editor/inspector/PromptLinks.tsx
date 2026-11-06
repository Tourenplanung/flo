import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { describeInteraction, interpretFlow, type FlowResult } from '@/core/prototypePrompt';
import { aiAvailable, applyLinks, interpretWithAi } from '@/editor/prototypePrompt';
import { useT } from '@/i18n';
import { getProject, useDocStore } from '@/store/docStore';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Prompt box that turns a description into prototype links.
 * With `sourceId` the prompt may omit the source (the selected layer is used).
 */
export function PromptLinks({ sourceId, multiline, testId }: { sourceId?: string; multiline?: boolean; testId: string }) {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const project = useDocStore((s) => s.project);
  const [text, setText] = useState('');
  const [result, setResult] = useState<(FlowResult & { ai?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!project) return null;

  const interpret = () => {
    const p = getProject();
    if (!p || !text.trim()) return null;
    const r = interpretFlow(p, text, sourceId);
    setResult(r);
    setError(r.links.length ? null : t('pp.nothing'));
    return r;
  };
  const apply = (r: FlowResult | null) => {
    if (r && applyLinks(r.links)) {
      setText('');
      setResult(null);
    }
  };
  const runAi = async () => {
    setBusy(true);
    setError(null);
    try {
      const links = await interpretWithAi(text, { sourceId });
      setResult({ links, unresolved: [], ai: true });
      if (!links.length) setError(t('pp.aiNone'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const name = (id: string) => project.nodes[id]?.name ?? '?';
  const fieldCls = 'w-full resize-none rounded-md border border-transparent bg-field px-2 py-1.5 text-[11.5px] leading-4 text-fg outline-none placeholder:text-fg-subtle hover:border-line-strong focus:border-accent';

  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <textarea
        data-testid={`${testId}-input`}
        rows={multiline ? 4 : 2}
        className={fieldCls}
        value={text}
        placeholder={multiline ? t('pp.flowPlaceholder') : t('pp.layerPlaceholder')}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !multiline) {
            e.preventDefault();
            apply(interpret());
          }
        }}
      />
      {multiline && <p className="text-[10.5px] leading-4 text-fg-subtle">{t('pp.flowHelp')}</p>}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid={`${testId}-interpret`}
          disabled={!text.trim()}
          onClick={() => (multiline ? interpret() : apply(interpret()))}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-field px-2.5 text-[11px] text-fg hover:bg-field-hover disabled:opacity-50"
        >
          <Wand2 size={12} /> {multiline ? t('pp.interpret') : t('pp.add')}
        </button>
        {aiAvailable() && (
          <button
            type="button"
            data-testid={`${testId}-ai`}
            disabled={busy || !text.trim()}
            onClick={() => void runAi()}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-field px-2.5 text-[11px] text-fg hover:bg-field-hover disabled:opacity-50"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t('pp.ai')}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-[#ffb3bb]">{error}</p>}
      {result && result.links.length > 0 && (multiline || result.ai) && (
        <div className="flex flex-col gap-1 rounded-md border border-line p-1.5" data-testid={`${testId}-preview`}>
          {result.links.map((l) => (
            <p key={l.interaction.id} className="text-[11px] leading-4 text-fg">
              <span className="font-medium">«{name(l.sourceId)}»</span> <span className="text-fg-muted">{describeInteraction(project, l.interaction, lang)}</span>
            </p>
          ))}
          {result.unresolved.length > 0 && (
            <p className="text-[10.5px] leading-4 text-[#ffcc66]">
              {t('pp.unresolved')} {result.unresolved.map((u) => `“${u}”`).join(', ')}
            </p>
          )}
          <button
            type="button"
            data-testid={`${testId}-apply`}
            onClick={() => apply(result)}
            className="mt-1 h-7 self-start rounded-md bg-accent-strong px-3 text-[11px] font-medium text-white hover:brightness-110"
          >
            {t('pp.apply', { n: result.links.length })}
          </button>
        </div>
      )}
    </div>
  );
}
