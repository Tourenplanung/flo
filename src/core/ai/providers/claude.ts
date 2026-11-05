/**
 * Claude provider. The browser talks only to the local flö proxy (server/claude-proxy.ts),
 * which holds the Anthropic credentials. No API key ever enters the client bundle or storage.
 */
import { AiError, type AiProvider, type GenerateRequest, type GenerateResult, type ProviderStatus } from '../provider';

export interface ClaudeProxyConfig {
  proxyUrl: string;
  token: string;
  model: string;
}

type FetchFn = typeof fetch;

export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];

export function createClaudeProvider(cfg: ClaudeProxyConfig, fetchFn: FetchFn = (...a) => fetch(...a)): AiProvider {
  const call = async (path: string, init: RequestInit, signal?: AbortSignal) => {
    let res: Response;
    try {
      res = await fetchFn(`${cfg.proxyUrl.replace(/\/+$/, '')}${path}`, {
        ...init,
        signal,
        headers: { ...(init.headers ?? {}), 'x-flo-token': cfg.token },
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AiError('Richiesta annullata / Request cancelled', 'aborted');
      throw new AiError(`Proxy Claude non raggiungibile su ${cfg.proxyUrl} (avvia \`npm run ai-proxy\`)`, 'connection');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const kind = body.kind === 'auth' || body.kind === 'token' ? 'auth' : 'provider';
      throw new AiError(String(body.error ?? `HTTP ${res.status}`), kind);
    }
    return body;
  };

  return {
    id: 'claude',
    label: 'Claude',
    billable: true,
    async check(signal): Promise<ProviderStatus> {
      const health = await call('/health', { method: 'GET' }, signal);
      return { ok: health.ok === true, message: `Proxy Claude attivo · modello predefinito ${String(health.defaultModel)}`, models: CLAUDE_MODELS };
    },
    async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
      const out = await call(
        '/generate',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: req.model || cfg.model, system: req.system, prompt: req.prompt, schema: req.schema, maxTokens: req.maxTokens }),
        },
        signal,
      );
      const result = out as unknown as GenerateResult;
      if (result.refusal) throw new AiError(`Claude ha rifiutato la richiesta (${result.refusal.category ?? 'policy'})`, 'refusal');
      if (req.schema && result.json === undefined) {
        throw new AiError(result.stopReason === 'max_tokens' ? 'Risposta troncata (limite di token)' : 'Risposta non valida dal modello', 'invalid_output');
      }
      return result;
    },
  };
}
