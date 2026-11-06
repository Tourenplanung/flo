import { Link2, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createId } from '@/core/ids';
import { describeInteraction, interpretLink, type LinkSpec } from '@/core/prototypePrompt';
import { aiAvailable, applyLinks, interpretWithAi } from '@/editor/prototypePrompt';
import { useT } from '@/i18n';
import { useDocStore } from '@/store/docStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';

const CHIPS = {
  it: ['Dissolvenza', 'Scorri da destra', 'Scorri da sinistra', 'Sale dal basso', 'Apri come overlay', 'Bottom sheet', 'Al passaggio del mouse', 'Istantaneo', 'Veloce', 'Lento'],
  en: ['Dissolve', 'Slide in from the right', 'Slide in from the left', 'Slide up from the bottom', 'Open as overlay', 'Bottom sheet', 'On hover', 'Instant', 'Fast', 'Slow'],
};

/** Prompt shown after dragging a prototype link onto a screen. */
export function LinkPrompt() {
  const t = useT();
  const lang = useSettingsStore((s) => s.language);
  const prompt = useEditorStore((s) => s.linkPrompt);
  const project = useDocStore((s) => s.project);
  const [text, setText] = useState('');
  const [ai, setAi] = useState<LinkSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const key = prompt ? `${prompt.sourceId}>${prompt.destinationId}` : '';

  useEffect(() => {
    setText('');
    setAi(null);
    setError(null);
    if (key) requestAnimationFrame(() => ref.current?.focus());
  }, [key]);

  const local = useMemo<LinkSpec | null>(() => {
    if (!prompt) return null;
    return { sourceId: prompt.sourceId, interaction: { id: createId(), ...interpretLink(text, prompt.destinationId) } };
  }, [text, prompt]);

  if (!prompt || !project || !local) return null;
  const source = project.nodes[prompt.sourceId];
  const dest = project.nodes[prompt.destinationId];
  if (!source || !dest) return null;
  const spec = ai ?? local;
  const close = () => useEditorStore.getState().setLinkPrompt(null);
  const create = () => {
    if (applyLinks([spec], 'Link screens')) close();
  };
  const runAi = async () => {
    setBusy(true);
    setError(null);
    try {
      const links = await interpretWithAi(text, { sourceId: prompt.sourceId, destinationId: prompt.destinationId });
      if (links[0]) setAi(links[0]);
      else setError(t('pp.aiNone'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Keep the popover inside the canvas.
  const box = ref.current?.closest('[data-canvas-root]');
  const cw = box?.clientWidth ?? window.innerWidth;
  const ch = box?.clientHeight ?? window.innerHeight;
  const left = Math.max(12, Math.min(prompt.x + 12, cw - Math.min(360, cw - 24) - 12));
  const top = Math.max(12, Math.min(prompt.y - 20, ch - 340));

  return (
    <div
      role="dialog"
      aria-label={t('pp.linkTitle', { from: source.name, to: dest.name })}
      data-testid="link-prompt"
      className="absolute z-30 flex w-[min(360px,calc(100%-24px))] flex-col gap-2 rounded-xl border border-line-strong bg-elevated p-3 shadow-2xl"
      style={{ left, top }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold">
          <Link2 size={13} className="shrink-0 text-accent" />
          <span className="truncate">{t('pp.linkTitle', { from: `«${source.name}»`, to: `«${dest.name}»` })}</span>
        </span>
        <button aria-label={t('pp.cancel')} className="text-fg-muted hover:text-fg" onClick={close}>
          <X size={14} />
        </button>
      </div>
      <textarea
        ref={ref}
        data-testid="link-prompt-input"
        rows={2}
        value={text}
        placeholder={t('pp.placeholder')}
        onChange={(e) => {
          setText(e.target.value);
          setAi(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            create();
          }
          if (e.key === 'Escape') close();
        }}
        className="resize-none rounded-md border border-transparent bg-field px-2 py-1.5 text-[12px] leading-4 text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
      />
      <div className="flex flex-wrap gap-1">
        {CHIPS[lang].map((c, i) => (
          <button
            key={c}
            type="button"
            data-testid={`link-chip-${i}`}
            className="rounded-full border border-line-strong px-2 py-0.5 text-[10.5px] text-fg-muted hover:border-accent hover:text-fg"
            onClick={() => {
              setText((v) => (v.trim() ? `${v.trim()}, ${c.toLowerCase()}` : c));
              setAi(null);
              ref.current?.focus();
            }}
          >
            {c}
          </button>
        ))}
      </div>
      <p data-testid="link-prompt-preview" className="rounded-md bg-field/60 px-2 py-1.5 text-[11px] leading-4 text-fg">
        {describeInteraction(project, spec.interaction, lang)}
      </p>
      <p className="text-[10px] text-fg-subtle">{ai ? 'AI' : t('pp.local')}</p>
      {error && <p className="text-[11px] text-[#ffb3bb]">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {aiAvailable() && (
          <button type="button" data-testid="link-prompt-ai" disabled={busy || !text.trim()} onClick={() => void runAi()} className="mr-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-field px-2.5 text-[11px] text-fg hover:bg-field-hover disabled:opacity-50">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {busy ? t('pp.aiWorking') : t('pp.ai')}
          </button>
        )}
        <button type="button" onClick={close} className="h-7 rounded-md px-2.5 text-[11px] text-fg-muted hover:text-fg">
          {t('pp.cancel')}
        </button>
        <button type="button" data-testid="link-prompt-create" onClick={create} className="h-7 rounded-md bg-accent-strong px-3 text-[11px] font-medium text-white hover:brightness-110">
          {t('pp.create')}
        </button>
      </div>
    </div>
  );
}
