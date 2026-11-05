import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { CLAUDE_MODELS, createClaudeProvider } from '@/core/ai/providers/claude';
import { createOllamaProvider } from '@/core/ai/providers/ollama';
import { useT } from '@/i18n';
import { useAiStore } from '@/store/aiStore';
import { Checkbox, SelectField } from '@/ui/common/controls';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'h-8 rounded-md border border-transparent bg-field px-2 text-[12px] text-fg outline-none hover:border-line-strong focus:border-accent';

export function AiSettingsDialog() {
  const t = useT();
  const s = useAiStore();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!s.settingsOpen) return null;

  const check = async () => {
    setBusy(true);
    setStatus(null);
    try {
      // Test the configured endpoint even before a model is chosen (the check lists the models).
      const p = s.provider === 'ollama' ? createOllamaProvider(s.ollama) : s.provider === 'claude' ? createClaudeProvider(s.claude) : null;
      if (!p) throw new Error(t('ai.notConfigured'));
      const r = await p.check(AbortSignal.timeout(8000));
      setStatus({ ok: r.ok, message: r.message });
      if (r.models) setModels(r.models);
      if (s.provider === 'ollama' && !s.ollama.model && r.models?.[0]) {
        s.setOllama({ model: r.models[0] });
        setStatus({ ok: true, message: `${r.message} · ${r.models[0]}` });
      }
    } catch (e) {
      setStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onPointerDown={() => s.setSettingsOpen(false)}>
      <div
        role="dialog"
        aria-label={t('ai.settings')}
        data-testid="ai-settings"
        className="w-[480px] rounded-xl border border-line-strong bg-elevated p-5 shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">{t('ai.settings')}</h2>
          <button aria-label="Close" className="text-fg-muted hover:text-fg" onClick={() => s.setSettingsOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <Field label={t('ai.provider')}>
            <SelectField
              testId="ai-provider"
              value={s.provider}
              options={[
                { value: 'none', label: t('ai.none') },
                { value: 'ollama', label: t('ai.ollama') },
                { value: 'claude', label: t('ai.claude') },
              ]}
              onChange={(v) => {
                s.setProvider(v);
                setStatus(null);
                setModels([]);
              }}
            />
          </Field>
          {s.provider === 'ollama' && (
            <>
              <p className="text-[11px] leading-4 text-fg-subtle">{t('ai.ollamaHelp')}</p>
              <Field label={t('ai.ollamaUrl')}>
                <input data-testid="ai-ollama-url" className={inputCls} value={s.ollama.baseUrl} onChange={(e) => s.setOllama({ baseUrl: e.target.value })} />
              </Field>
              <Field label={t('ai.model')}>
                {models.length ? (
                  <SelectField value={s.ollama.model} options={models.map((m) => ({ value: m, label: m }))} onChange={(model) => s.setOllama({ model })} />
                ) : (
                  <input data-testid="ai-ollama-model" className={inputCls} value={s.ollama.model} placeholder="qwen2.5:14b" onChange={(e) => s.setOllama({ model: e.target.value })} />
                )}
              </Field>
            </>
          )}
          {s.provider === 'claude' && (
            <>
              <p className="text-[11px] leading-4 text-fg-subtle">{t('ai.claudeHelp')}</p>
              <Field label={t('ai.proxyUrl')}>
                <input data-testid="ai-proxy-url" className={inputCls} value={s.claude.proxyUrl} onChange={(e) => s.setClaude({ proxyUrl: e.target.value })} />
              </Field>
              <Field label={t('ai.token')}>
                <input data-testid="ai-proxy-token" type="password" autoComplete="off" className={inputCls} value={s.claude.token} onChange={(e) => s.setClaude({ token: e.target.value.trim() })} />
              </Field>
              <Field label={t('ai.model')}>
                <SelectField value={s.claude.model} options={CLAUDE_MODELS.map((m) => ({ value: m, label: m }))} onChange={(model) => s.setClaude({ model })} />
              </Field>
            </>
          )}
          {s.provider !== 'none' && (
            <div className="flex items-center gap-3">
              <button data-testid="ai-check" disabled={busy} onClick={check} className="h-8 rounded-md bg-field px-3 text-[12px] text-fg hover:bg-field-hover disabled:opacity-50">
                {busy ? t('ai.checking') : t('ai.check')}
              </button>
              {status && (
                <span data-testid="ai-status" className={`flex items-center gap-1.5 text-[11px] ${status.ok ? 'text-success' : 'text-[#ffb3bb]'}`}>
                  {status.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  {status.message}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CostConfirmDialog() {
  const t = useT();
  const c = useAiStore((s) => s.confirmation);
  const [remember, setRemember] = useState(false);
  if (!c) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div role="alertdialog" aria-label={t('ai.confirmTitle')} data-testid="ai-cost-confirm" className="w-[420px] rounded-xl border border-line-strong bg-elevated p-5 shadow-2xl">
        <h2 className="mb-2 text-[14px] font-semibold">{t('ai.confirmTitle')}</h2>
        <p className="text-[12px] leading-5 text-fg-muted">{t('ai.confirmBody', { provider: c.provider, model: c.model, purpose: c.purpose, tokens: c.estimatedInputTokens.toLocaleString() })}</p>
        {c.estimatedMaxCost !== null && <p className="mt-1 text-[12px] leading-5 text-fg">{t('ai.confirmMax', { cost: c.estimatedMaxCost.toFixed(2) })}</p>}
        <div className="mt-3">
          <Checkbox label={t('ai.confirmSession')} checked={remember} onChange={setRemember} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button data-testid="ai-cost-decline" className="h-8 rounded-md bg-field px-3 text-[12px] hover:bg-field-hover" onClick={() => c.resolve(false)}>
            {t('ai.decline')}
          </button>
          <button
            data-testid="ai-cost-accept"
            className="h-8 rounded-md bg-accent-strong px-3 text-[12px] font-medium text-white hover:bg-accent"
            onClick={() => {
              if (remember) useAiStore.getState().approveSession(true);
              c.resolve(true);
            }}
          >
            {t('ai.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
