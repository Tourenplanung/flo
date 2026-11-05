/** Provider-neutral AI interface. Providers are optional; none is required to use flö. */

export interface GenerateRequest {
  system: string;
  prompt: string;
  /** JSON schema for structured output (providers that support it constrain the output). */
  schema?: Record<string, unknown>;
  maxTokens?: number;
  /** Optional model override. */
  model?: string;
}

export interface GenerateResult {
  text: string;
  /** Parsed JSON when a schema was requested and the output parsed. */
  json?: unknown;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
  stopReason?: string | null;
  refusal?: { category: string | null; explanation?: string | null } | null;
}

export interface ProviderStatus {
  ok: boolean;
  message: string;
  models?: string[];
}

export type ProviderId = 'ollama' | 'claude';

export interface AiProvider {
  id: ProviderId;
  label: string;
  /** Calls may cost money: the UI must ask before each request. */
  billable: boolean;
  check(signal?: AbortSignal): Promise<ProviderStatus>;
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult>;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'connection' | 'auth' | 'aborted' | 'refusal' | 'invalid_output' | 'provider' = 'provider',
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Rough cost estimate in USD for the Claude models flö offers (per million tokens). */
export const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-fable-5-1': { input: 10, output: 50 },
};

export function estimateCost(model: string, usage: { inputTokens: number; outputTokens: number }): number | null {
  const p = CLAUDE_PRICES[model];
  if (!p) return null;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

/** Very rough token estimate (≈4 characters per token) used for pre-call cost previews. */
export const approxTokens = (s: string) => Math.ceil(s.length / 4);
