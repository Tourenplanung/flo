import { expect, test, type Page } from '@playwright/test';

/**
 * Milestone 4: AI providers are mocked at the network level (Ollama HTTP API and the local
 * Claude proxy), so the test exercises the real browser code paths without paid calls.
 */

const plan = {
  summary: 'Ho creato una dashboard per il concierge automobilistico.',
  actions: [
    { action: 'create', ref: 'screen', kind: 'frame', name: 'Dashboard concierge', layout: 'vertical', width: 1440, gap: 24, paddingX: 40, paddingY: 40, fill: '#F6F7FB', role: 'main' },
    { action: 'create', ref: 'h', parent: 'screen', kind: 'text', text: 'Le tue prenotazioni', fontSize: 36, fontWeight: 800, role: 'h1', textColor: '#111827' },
    { action: 'create', ref: 'row', parent: 'screen', kind: 'frame', layout: 'horizontal', gap: 16, widthMode: 'fill' },
    { action: 'create', ref: 'k1', parent: 'row', kind: 'frame', name: 'KPI ritiri', layout: 'vertical', fill: '#FFFFFF', radius: 16, paddingX: 20, paddingY: 20, gap: 4, role: 'article', widthMode: 'fill' },
    { action: 'create', parent: 'k1', kind: 'text', text: 'Ritiri oggi', fontSize: 14, textColor: '#6B7280' },
    { action: 'create', parent: 'k1', kind: 'text', text: '12', fontSize: 32, fontWeight: 700, textColor: '#111827' },
    { action: 'create', parent: 'screen', kind: 'frame', name: 'CTA', layout: 'horizontal', paddingX: 20, paddingY: 12, fill: '#2B59FF', radius: 10, role: 'button' },
    { action: 'update', id: 'does-not-exist', name: 'x' },
  ],
};

async function mockOllama(page: Page, chatBodies: unknown[] = []) {
  await page.route('http://localhost:11434/api/tags', (r) => r.fulfill({ json: { models: [{ name: 'qwen2.5:14b' }] } }));
  await page.route('http://localhost:11434/api/chat', async (r) => {
    const body = r.request().postDataJSON();
    chatBodies.push(body);
    const system = String(body.messages?.[0]?.content ?? '');
    const content = system.includes('information architect')
      ? JSON.stringify({ pages: [{ name: 'Home', depth: 0 }, { name: 'Prenota ritiro', depth: 0 }, { name: 'Officine', depth: 1 }] })
      : JSON.stringify(plan);
    await r.fulfill({ json: { model: 'qwen2.5:14b', message: { content }, prompt_eval_count: 1500, eval_count: 600, done_reason: 'stop' } });
  });
}

async function newProject(page: Page) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('editor')).toBeVisible();
}

test('assistant with Ollama: structured plan → previewed, editable layers → accept / reject', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const bodies: unknown[] = [];
  await mockOllama(page, bodies);
  await newProject(page);

  // Without a provider the assistant explains how to configure one (AI is optional).
  await page.getByTestId('ai-toggle').click();
  await expect(page.getByTestId('ai-not-configured')).toBeVisible();

  await page.getByTestId('ai-open-settings').click();
  await page.getByTestId('ai-provider').selectOption('ollama');
  await page.getByTestId('ai-check').click();
  await expect(page.getByTestId('ai-status')).toContainText('Ollama');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);

  await page.getByTestId('ai-input').fill('Crea una dashboard SaaS per un servizio di concierge automobilistico');
  await page.getByTestId('ai-send').click();
  const turn = page.getByTestId('ai-turn').last();
  await expect(turn).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('ai-summary')).toContainText('dashboard');
  await expect(turn).toContainText('1 azioni scartate');
  await expect(page.getByTestId('ai-usage')).toContainText('1500');

  // Structured output was requested with the plan JSON schema.
  const req = bodies[0] as { format: { properties: object }; stream: boolean };
  expect(req.stream).toBe(false);
  expect(Object.keys(req.format.properties)).toEqual(['summary', 'actions']);

  // Real, editable layers (not an image).
  const world = page.locator('[data-canvas-world]');
  const screen = world.locator('[data-name="Dashboard concierge"]');
  await expect(screen).toBeVisible();
  await expect(screen).toContainText('Le tue prenotazioni');
  await expect(screen.locator('[data-name="KPI ritiri"]')).toHaveCSS('border-radius', '16px');
  await expect(page.getByTestId('inspector')).toContainText('Dashboard concierge');

  await page.getByTestId('ai-accept').click();
  await expect(turn).toHaveAttribute('data-status', 'accepted');
  // Traceable in history.
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('history-panel')).toContainText('AI ·');

  // A second request, rejected: the change is undone.
  await page.getByTestId('ai-input').fill('Aggiungi un’altra variante');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-turn').last()).toHaveAttribute('data-status', 'pending');
  await expect(world.locator('[data-name="Dashboard concierge"]')).toHaveCount(2);
  await page.getByTestId('ai-reject').click();
  await expect(page.getByTestId('ai-turn').last()).toHaveAttribute('data-status', 'rejected');
  await expect(world.locator('[data-name="Dashboard concierge"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Claude via local proxy asks to confirm the cost before every paid call', async ({ page }) => {
  let calls = 0;
  await page.route('http://127.0.0.1:8787/health', (r) => r.fulfill({ json: { ok: true, defaultModel: 'claude-opus-5-5' } }));
  await page.route('http://127.0.0.1:8787/generate', async (r) => {
    calls++;
    expect(r.request().headers()['x-flo-token']).toBe('session-token-123');
    await r.fulfill({ json: { text: JSON.stringify(plan), json: plan, model: 'claude-opus-5-5', stopReason: 'end_turn', refusal: null, usage: { inputTokens: 2400, outputTokens: 900 } } });
  });
  await newProject(page);
  await page.getByTestId('ai-toggle').click();
  await page.getByTestId('ai-open-settings').click();
  await page.getByTestId('ai-provider').selectOption('claude');
  await page.getByTestId('ai-proxy-token').fill('session-token-123');
  await page.getByTestId('ai-check').click();
  await expect(page.getByTestId('ai-status')).toContainText('claude-opus-5-5');
  await page.mouse.click(5, 5);

  // Declining the cost sends nothing.
  await page.getByTestId('ai-input').fill('Genera una schermata di login');
  await page.getByTestId('ai-send').click();
  await expect(page.getByTestId('ai-cost-confirm')).toContainText('claude-opus-5-5');
  await page.getByTestId('ai-cost-decline').click();
  await expect(page.getByTestId('ai-error')).toContainText('costo non autorizzato');
  expect(calls).toBe(0);

  // Accepting sends one request and reports usage and estimated cost.
  await page.getByTestId('ai-input').fill('Genera una schermata di login');
  await page.getByTestId('ai-send').click();
  await page.getByTestId('ai-cost-accept').click();
  await expect(page.getByTestId('ai-turn').last()).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('ai-usage').last()).toContainText('USD');
  expect(calls).toBe(1);
});

test('workflow AI nodes run with a configured provider', async ({ page }) => {
  await mockOllama(page);
  await newProject(page);
  await page.getByTestId('ai-toggle').click();
  await page.getByTestId('ai-open-settings').click();
  await page.getByTestId('ai-provider').selectOption('ollama');
  await page.getByTestId('ai-check').click();
  await expect(page.getByTestId('ai-status')).toBeVisible();
  await page.mouse.click(5, 5);

  await page.getByTestId('mode-workflow').click();
  await page.getByTestId('wf-new').click();
  await page.getByTestId('wf-add-brief-input').click();
  await page.getByTestId('wf-param-text').fill('Concierge auto: ritiro e consegna per la manutenzione.');
  await page.getByTestId('wf-param-text').blur();
  await page.getByTestId('wf-add-info-architecture').click();
  const out = page.locator('[data-wf-node="brief-input"] .react-flow__handle.source');
  const inp = page.locator('[data-wf-node="info-architecture"] .react-flow__handle.target');
  const a = (await out.boundingBox())!;
  const b = (await inp.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('wf-run-all').click();
  await expect(page.locator('[data-wf-node="info-architecture"]')).toHaveAttribute('data-status', 'done');
  await page.locator('[data-wf-node="info-architecture"]').click();
  await expect(page.getByTestId('wf-sitemap-preview')).toContainText('Prenota ritiro');
});
