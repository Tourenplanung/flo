import { expect, test } from '@playwright/test';

test('prototype with prompts: drag to connect + describe the animation, and a whole flow from text', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-insert').click();
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('insert-frame-mobile').click();
    await page.getByTestId('insert-button').click();
  }
  await page.getByTestId('tab-layers').click();
  for (const name of ['Menu', 'Dettaglio', 'Home']) {
    await page.locator('[data-layer-id]').filter({ hasText: /^Mobile$/ }).first().dblclick();
    await page.getByTestId('layer-rename').fill(name);
    await page.getByTestId('layer-rename').press('Enter');
  }
  await page.keyboard.press('Shift+1');
  const world = page.locator('[data-canvas-world]');

  /* ---------- 1. Drag from the Home button onto Dettaglio, then describe the link ---------- */
  await world.locator('[data-name="Home"] [data-name="Button"]').click();
  const handle = page.getByTestId('proto-link-handle');
  await expect(handle).toBeVisible();
  const hb = (await handle.boundingBox())!;
  const target = (await world.locator('[data-name="Dettaglio"]').first().boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await expect(page.getByTestId('proto-link-target')).toBeVisible();
  await page.mouse.up();

  const prompt = page.getByTestId('link-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('«Button» → «Dettaglio»');
  await expect(page.getByTestId('link-prompt-input')).toBeFocused();
  await page.getByTestId('link-prompt-input').fill('al clic scorri da destra in 400 ms');
  await expect(page.getByTestId('link-prompt-preview')).toHaveText('Al clic → vai a «Dettaglio» · scorre da destra · 400 ms');
  await page.getByTestId('link-prompt-input').press('Enter');
  await expect(prompt).toHaveCount(0);
  await expect(page.getByTestId('proto-interaction')).toHaveCount(1);
  await expect(page.getByTestId('proto-transition')).toHaveValue('slide-left');

  // Chips build the prompt too: hover + bottom-sheet overlay from Dettaglio's button onto Menu.
  await world.locator('[data-name="Dettaglio"] [data-name="Button"]').click();
  const hb2 = (await handle.boundingBox())!;
  const menu = (await world.locator('[data-name="Menu"]').first().boundingBox())!;
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(menu.x + menu.width / 2, menu.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('link-chip-5').click(); // Bottom sheet
  await expect(page.getByTestId('link-prompt-preview')).toContainText('apri come overlay «Menu» · in basso');
  await page.getByTestId('link-prompt-create').click();
  await expect(page.getByTestId('proto-action')).toHaveValue('open-overlay');

  // Dropping on empty canvas or the source's own screen does not ask anything.
  await world.locator('[data-name="Home"] [data-name="Button"]').click();
  const hb3 = (await handle.boundingBox())!;
  await page.mouse.move(hb3.x + 8, hb3.y + 8);
  await page.mouse.down();
  await page.mouse.move(hb3.x - 60, hb3.y + 30, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('link-prompt')).toHaveCount(0);

  /* ---------- 2. Prompt for the selected layer ---------- */
  await world.locator('[data-name="Menu"] [data-name="Button"]').click();
  await page.getByTestId('proto-prompt-input').fill('chiudi l’overlay');
  await page.getByTestId('proto-prompt-input').press('Enter');
  await expect(page.getByTestId('proto-action')).toHaveValue('close-overlay');

  /* ---------- 3. A whole flow from one prompt (nothing selected) ---------- */
  await page.getByTestId('proto-prompt-input').blur();
  for (let i = 0; i < 3 && !(await page.getByTestId('flow-prompt').isVisible()); i++) await page.keyboard.press('Escape');
  await expect(page.getByTestId('flow-prompt')).toBeVisible();
  await page.getByTestId('flow-prompt-input').fill('Dettaglio porta a Home con dissolvenza veloce\nHome apre Menu come overlay al centro senza oscurare lo sfondo\nquesta frase non vuol dire niente');
  await page.getByTestId('flow-prompt-interpret').click();
  const preview = page.getByTestId('flow-prompt-preview');
  await expect(preview).toContainText('«Dettaglio» Al clic → vai a «Home» · dissolvenza · 200 ms');
  await expect(preview).toContainText('«Home» Al clic → apri come overlay «Menu» · al centro');
  await expect(preview).toContainText('questa frase non vuol dire niente');
  await page.getByTestId('flow-prompt-apply').click();
  await expect(preview).toHaveCount(0);

  // One undo step removes the whole flow.
  await page.locator('[data-frame-label]', { hasText: 'Dettaglio' }).click();
  await expect(page.getByTestId('proto-interaction')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('proto-interaction')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');

  /* ---------- 4. The prompt-made links work in the player ---------- */
  await world.locator('[data-name="Home"] [data-name="Button"]').click();
  await page.getByTestId('proto-play').click();
  const view = page.getByTestId('proto-screen-view');
  await expect(view).toHaveAttribute('data-screen', 'Home');
  await view.locator('[data-name="Button"]').click();
  await expect(view).toHaveAttribute('data-screen', 'Dettaglio');
  await expect(view.locator('xpath=..')).toHaveCSS('animation-name', 'flo-slide-left');
  await expect(view.locator('xpath=..')).toHaveCSS('animation-duration', '0.4s');
  expect(errors).toEqual([]);
});

test('link prompt can be interpreted by a local AI (Ollama, mocked) and the output is validated', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('http://localhost:11434/api/tags', (r) => r.fulfill({ json: { models: [{ name: 'qwen2.5:14b' }] } }));
  await page.route('http://localhost:11434/api/chat', async (r) => {
    const body = r.request().postDataJSON();
    const user = String(body.messages?.[1]?.content ?? '');
    const dest = /Destination screen: (\S+)/.exec(user)![1];
    const source = /Default source layer: (\S+)/.exec(user)![1];
    const content = JSON.stringify({
      links: [
        { sourceId: source, trigger: 'click', action: 'navigate', destinationId: dest, transition: 'slide-up', durationMs: 450 },
        { sourceId: 'invented-id', trigger: 'click', action: 'back' },
      ],
    });
    await r.fulfill({ json: { model: 'qwen2.5:14b', message: { content }, prompt_eval_count: 100, eval_count: 50, done_reason: 'stop' } });
  });
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('ai-toggle').click();
  await page.getByTestId('ai-open-settings').click();
  await page.getByTestId('ai-provider').selectOption('ollama');
  await page.getByTestId('ai-check').click();
  await expect(page.getByTestId('ai-status')).toContainText('Ollama');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await page.getByTestId('ai-toggle').click();

  await page.getByTestId('tab-insert').click();
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('insert-frame-mobile').click();
    await page.getByTestId('insert-button').click();
  }
  await page.keyboard.press('Shift+1');
  const world = page.locator('[data-canvas-world]');
  const screens = world.locator('[data-node-type="frame"][data-name="Mobile"]');
  await screens.first().locator('[data-name="Button"]').click();
  const hb = (await page.getByTestId('proto-link-handle').boundingBox())!;
  const target = (await screens.nth(1).boundingBox())!;
  await page.mouse.move(hb.x + 8, hb.y + 8);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 60, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('link-prompt-input').fill('fallo comparire come una card che sale, con calma');
  await page.getByTestId('link-prompt-ai').click();
  await expect(page.getByTestId('link-prompt-preview')).toContainText('sale dal basso · 450 ms');
  await page.getByTestId('link-prompt-create').click();
  await expect(page.getByTestId('proto-interaction')).toHaveCount(1);
  await expect(page.getByTestId('proto-transition')).toHaveValue('slide-up');
  expect(errors).toEqual([]);
});
