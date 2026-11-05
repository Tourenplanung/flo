/** Editor-side AI service: active provider, authorization of billable calls, generation. */
import type { AiProvider, GenerateRequest, GenerateResult } from '@/core/ai/provider';
import { AiError, approxTokens, CLAUDE_PRICES } from '@/core/ai/provider';
import { createClaudeProvider } from '@/core/ai/providers/claude';
import { createOllamaProvider } from '@/core/ai/providers/ollama';
import { useAiStore } from '@/store/aiStore';

export function getActiveProvider(): AiProvider | null {
  const s = useAiStore.getState();
  if (s.provider === 'ollama' && s.ollama.baseUrl && s.ollama.model) return createOllamaProvider(s.ollama);
  if (s.provider === 'claude' && s.claude.proxyUrl && s.claude.token) return createClaudeProvider(s.claude);
  return null;
}

export function activeModel(): string {
  const s = useAiStore.getState();
  return s.provider === 'claude' ? s.claude.model : s.provider === 'ollama' ? s.ollama.model : '';
}

let confirmSeq = 0;

/** Asks the user before a call that may cost money. Resolves false if declined. */
export function confirmBillable(provider: AiProvider, req: GenerateRequest, purpose: string): Promise<boolean> {
  const s = useAiStore.getState();
  if (!provider.billable || s.sessionApproved) return Promise.resolve(true);
  const model = req.model || activeModel();
  const inTok = approxTokens(req.system + req.prompt + JSON.stringify(req.schema ?? {}));
  const price = CLAUDE_PRICES[model];
  const maxCost = price ? (inTok * price.input + (req.maxTokens ?? 32_000) * price.output) / 1_000_000 : null;
  return new Promise((resolve) => {
    s.setConfirmation({
      id: ++confirmSeq,
      provider: provider.label,
      model,
      purpose,
      estimatedInputTokens: inTok,
      estimatedMaxCost: maxCost,
      resolve: (ok) => {
        useAiStore.getState().setConfirmation(null);
        resolve(ok);
      },
    });
  });
}

/** Generates with the active provider after the user authorized any billable call. */
export async function generateWithConsent(req: GenerateRequest, purpose: string, signal?: AbortSignal): Promise<GenerateResult> {
  const provider = getActiveProvider();
  if (!provider) throw new AiError('Nessun provider AI configurato. Apri Impostazioni AI.', 'provider');
  if (!(await confirmBillable(provider, req, purpose))) throw new AiError('Richiesta annullata: costo non autorizzato', 'aborted');
  return provider.generate(req, signal);
}
