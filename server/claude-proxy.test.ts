import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProxyServer, type ClaudeClient } from './claude-proxy';

let close: (() => void) | null = null;
afterEach(() => close?.());

async function start(client: ClaudeClient) {
  const server = createProxyServer({ client, token: 'secret-token', allowedOrigins: ['http://localhost:5173'] });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  close = () => server.close();
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function fakeClient(capture: (params: Record<string, unknown>) => void): ClaudeClient {
  return {
    beta: {
      messages: {
        stream: ((params: Record<string, unknown>) => {
          capture(params);
          return {
            finalMessage: async () => ({
              model: params.model,
              stop_reason: 'end_turn',
              stop_details: null,
              content: [{ type: 'text', text: '{"summary":"ok","actions":[]}' }],
              usage: { input_tokens: 120, output_tokens: 30 },
            }),
          };
        }) as never,
      },
    },
    models: { list: (() => ({ async *[Symbol.asyncIterator]() { yield { id: 'claude-opus-5-5' }; } })) as never },
  };
}

describe('claude proxy', () => {
  it('requires the session token and an allowed origin', async () => {
    const base = await start(fakeClient(() => {}));
    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: { 'x-flo-token': 'wrong-token!' } })).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers: { 'x-flo-token': 'secret-token', origin: 'https://evil.example' } })).status).toBe(403);
    const ok = await fetch(`${base}/health`, { headers: { 'x-flo-token': 'secret-token', origin: 'http://localhost:5173' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('forwards structured generation with the current defaults and reports usage', async () => {
    const capture = vi.fn();
    const base = await start(fakeClient(capture));
    const res = await fetch(`${base}/generate`, {
      method: 'POST',
      headers: { 'x-flo-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ system: 'sys', prompt: 'make a login screen', schema: { type: 'object' } }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ json: { summary: 'ok', actions: [] }, usage: { inputTokens: 120, outputTokens: 30 }, model: 'claude-opus-5-5' });
    const params = capture.mock.calls[0]![0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect(params).not.toHaveProperty('thinking');
  });

  it('validates input and rejects non-Claude models', async () => {
    const base = await start(fakeClient(() => {}));
    const res = await fetch(`${base}/generate`, {
      method: 'POST',
      headers: { 'x-flo-token': 'secret-token', 'content-type': 'application/json' },
      body: JSON.stringify({ system: 's', prompt: 'p', model: 'gpt-5' }),
    });
    expect(res.status).toBe(400);
  });
});
