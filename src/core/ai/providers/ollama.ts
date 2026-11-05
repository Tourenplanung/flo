/**
 * Ollama (local LLM) provider. Talks to the Ollama HTTP API directly from the browser.
 * Ollama must allow the app's origin (OLLAMA_ORIGINS) — see docs/AI.md.
 */
import { AiError, type AiProvider, type GenerateRequest, type GenerateResult, type ProviderStatus } from '../provider';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

type FetchFn = typeof fetch;

function url(base: string, path: string) {
  return `${base.replace(/\/+$/, '')}${path}`;
}

export function createOllamaProvider(cfg: OllamaConfig, fetchFn: FetchFn = (...a) => fetch(...a)): AiProvider {
  const request = async (path: string, init: RequestInit, signal?: AbortSignal) => {
    try {
      return await fetchFn(url(cfg.baseUrl, path), { ...init, signal });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AiError('Richiesta annullata / Request cancelled', 'aborted');
      throw new AiError(`Ollama non raggiungibile su ${cfg.baseUrl} (avviato? OLLAMA_ORIGINS consente questa origine?)`, 'connection');
    }
  };

  return {
    id: 'ollama',
    label: 'Ollama',
    billable: false,
    async check(signal): Promise<ProviderStatus> {
      const res = await request('/api/tags', { method: 'GET' }, signal);
      if (!res.ok) return { ok: false, message: `Ollama: HTTP ${res.status}` };
      const data = (await res.json()) as { models?: { name: string }[] };
      const models = (data.models ?? []).map((m) => m.name);
      if (!models.length) return { ok: false, message: 'Ollama è attivo ma non ha modelli: esegui `ollama pull <modello>`', models };
      const has = !cfg.model || models.includes(cfg.model);
      return { ok: has, message: has ? `Ollama · ${models.length} modelli` : `Modello “${cfg.model}” non trovato in Ollama`, models };
    },
    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
      const model = req.model || cfg.model;
      if (!model) throw new AiError('Seleziona un modello Ollama nelle impostazioni AI', 'provider');
      const res = await request(
        '/api/chat',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            // Ollama structured outputs: constrain to the JSON schema when provided.
            ...(req.schema ? { format: req.schema } : {}),
            options: { temperature: 0.4, ...(req.maxTokens ? { num_predict: req.maxTokens } : {}) },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.prompt },
            ],
          }),
        },
        signal,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new AiError(`Ollama: HTTP ${res.status} ${body.slice(0, 200)}`, 'provider');
      }
      const data = (await res.json()) as { message?: { content?: string }; model?: string; prompt_eval_count?: number; eval_count?: number; done_reason?: string };
      const text = data.message?.content ?? '';
      let json: unknown;
      if (req.schema) {
        try {
          json = JSON.parse(text);
        } catch {
          throw new AiError('Il modello non ha restituito JSON valido', 'invalid_output');
        }
      }
      return {
        text,
        json,
        model: data.model ?? model,
        stopReason: data.done_reason ?? null,
        usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
      };
    },
  };
}
