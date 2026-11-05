/**
 * flö — local Claude proxy.
 *
 * The browser never sees the Anthropic API key: this process reads it from the environment
 * (ANTHROPIC_API_KEY, or an `ant auth login` profile resolved by the SDK) and exposes a tiny,
 * locked-down HTTP API on 127.0.0.1 for structured JSON generation.
 *
 * Security:
 * - binds to 127.0.0.1 only;
 * - CORS limited to an allowlist of origins (FLO_ALLOWED_ORIGINS);
 * - every request must carry the session token (x-flo-token) printed at startup, so other
 *   web pages open in the browser cannot spend the user's credits;
 * - request bodies are size-limited and validated; only `claude-*` model ids are accepted.
 *
 * Run:  ANTHROPIC_API_KEY=... npm run ai-proxy
 */
import Anthropic from '@anthropic-ai/sdk';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { z } from 'zod';

export const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_BODY = 2_000_000;

const GenerateSchema = z.object({
  model: z.string().regex(/^claude-[a-z0-9.-]+$/).max(80).optional(),
  system: z.string().max(200_000),
  prompt: z.string().min(1).max(400_000),
  schema: z.record(z.string(), z.unknown()).optional(),
  maxTokens: z.number().int().min(256).max(64_000).optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
});

export type GenerateBody = z.infer<typeof GenerateSchema>;

/** Minimal surface of the SDK client used by the proxy (lets tests inject a fake). */
export interface ClaudeClient {
  beta: { messages: { stream: Anthropic['beta']['messages']['stream'] } };
  models: { list: Anthropic['models']['list'] };
}

export interface ProxyOptions {
  client: ClaudeClient;
  token: string;
  allowedOrigins: string[];
  defaultModel?: string;
  log?: (msg: string) => void;
}

function sameToken(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function errorResponse(e: unknown): { status: number; body: { error: string; kind: string } } {
  if (e instanceof Anthropic.AuthenticationError) return { status: 401, body: { kind: 'auth', error: 'Anthropic credentials missing or invalid on the proxy (set ANTHROPIC_API_KEY).' } };
  if (e instanceof Anthropic.PermissionDeniedError) return { status: 403, body: { kind: 'permission', error: e.message } };
  if (e instanceof Anthropic.NotFoundError) return { status: 404, body: { kind: 'not_found', error: e.message } };
  if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { kind: 'rate_limit', error: 'Rate limited by the Anthropic API — retry later.' } };
  if (e instanceof Anthropic.BadRequestError) return { status: 400, body: { kind: 'bad_request', error: e.message } };
  if (e instanceof Anthropic.APIUserAbortError) return { status: 499, body: { kind: 'aborted', error: 'Request cancelled' } };
  if (e instanceof Anthropic.APIConnectionError) return { status: 502, body: { kind: 'connection', error: 'Could not reach the Anthropic API.' } };
  if (e instanceof Anthropic.APIError) return { status: e.status ?? 500, body: { kind: 'api', error: e.message } };
  if (e instanceof Error && /authentication|api key|credential/i.test(e.message)) {
    return { status: 401, body: { kind: 'auth', error: 'No Anthropic credentials on the proxy: set ANTHROPIC_API_KEY (or run `ant auth login`) and restart it.' } };
  }
  return { status: 500, body: { kind: 'internal', error: e instanceof Error ? e.message : String(e) } };
}

export async function generate(client: ClaudeClient, body: GenerateBody, defaultModel: string, signal: AbortSignal) {
  const stream = client.beta.messages.stream(
    {
      model: body.model ?? defaultModel,
      max_tokens: body.maxTokens ?? 32_000,
      system: body.system,
      messages: [{ role: 'user', content: body.prompt }],
      // Adaptive thinking is the default on current models; effort controls depth and spend.
      output_config: {
        effort: body.effort ?? 'medium',
        ...(body.schema ? { format: { type: 'json_schema' as const, schema: body.schema } } : {}),
      },
      // If a safety classifier declines, let the API re-run the request on its recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    },
    { signal },
  );
  const message = await stream.finalMessage();
  const text = message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  let json: unknown = undefined;
  if (body.schema && message.stop_reason !== 'refusal' && message.stop_reason !== 'max_tokens') {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return {
    text,
    json,
    model: message.model,
    stopReason: message.stop_reason,
    refusal: message.stop_reason === 'refusal' ? (message.stop_details ?? { category: null }) : null,
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  };
}

export function createProxyServer(opts: ProxyOptions): http.Server {
  const log = opts.log ?? (() => {});
  const defaultModel = opts.defaultModel ?? DEFAULT_MODEL;
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = !origin || opts.allowedOrigins.includes(origin);
    if (origin && allowed) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
      res.setHeader('access-control-allow-headers', 'content-type, x-flo-token');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-max-age', '600');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(allowed ? 204 : 403);
      return res.end();
    }
    if (!allowed) return send(res, 403, { kind: 'origin', error: `Origin ${origin} is not allowed (FLO_ALLOWED_ORIGINS)` });
    if (!sameToken(req.headers['x-flo-token'] as string | undefined, opts.token)) {
      return send(res, 401, { kind: 'token', error: 'Missing or wrong flö proxy token' });
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, provider: 'claude', defaultModel });
      if (req.method === 'GET' && url.pathname === '/models') {
        const ids: string[] = [];
        for await (const m of opts.client.models.list()) ids.push(m.id);
        return send(res, 200, { models: ids, defaultModel });
      }
      if (req.method === 'POST' && url.pathname === '/generate') {
        let parsed: GenerateBody;
        try {
          const raw = JSON.parse(await readBody(req));
          const r = GenerateSchema.safeParse(raw);
          if (!r.success) return send(res, 400, { kind: 'validation', error: r.error.issues[0]?.message ?? 'Invalid request' });
          parsed = r.data;
        } catch (e) {
          return send(res, 400, { kind: 'validation', error: e instanceof Error ? e.message : 'Invalid JSON' });
        }
        // Cancel the upstream request if the browser goes away.
        const controller = new AbortController();
        res.on('close', () => {
          if (!res.writableFinished) controller.abort();
        });
        const started = Date.now();
        const out = await generate(opts.client, parsed, defaultModel, controller.signal);
        log(`generate ${out.model} in=${out.usage.inputTokens} out=${out.usage.outputTokens} ${Date.now() - started}ms stop=${out.stopReason}`);
        return send(res, 200, out);
      }
      return send(res, 404, { kind: 'not_found', error: 'Unknown endpoint' });
    } catch (e) {
      const { status, body } = errorResponse(e);
      log(`error ${status} ${body.kind}: ${body.error}`);
      return send(res, status, body);
    }
  });
}

/* ------------------------------------------------------------------ */
/* CLI entry                                                           */
/* ------------------------------------------------------------------ */

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = Number(process.env.FLO_PROXY_PORT ?? 8787);
  const token = process.env.FLO_PROXY_TOKEN || randomBytes(18).toString('base64url');
  const allowedOrigins = (process.env.FLO_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const server = createProxyServer({
    client: new Anthropic(),
    token,
    allowedOrigins,
    defaultModel: process.env.FLO_CLAUDE_MODEL || DEFAULT_MODEL,
    log: (m) => console.log(`[flö-proxy] ${m}`),
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[flö-proxy] listening on http://127.0.0.1:${port}`);
    console.log(`[flö-proxy] allowed origins: ${allowedOrigins.join(', ')}`);
    console.log(`[flö-proxy] session token (paste it in flö → AI settings): ${token}`);
    if (!process.env.ANTHROPIC_API_KEY) console.log('[flö-proxy] ANTHROPIC_API_KEY is not set: the SDK will try other credential sources (e.g. `ant auth login`).');
  });
}
