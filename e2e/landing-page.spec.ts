import { expect, test, type Page } from '@playwright/test';

/**
 * Milestone 1 acceptance scenario: build a simple landing page manually, edit it,
 * persist it, reload, reopen and continue editing.
 */

function nodeByName(page: Page, name: string) {
  return page.locator(`[data-canvas-world] [data-name="${name}"]`).first();
}

/** Selects a layer by clicking near its top-left corner on the canvas. */
async function selectLayer(page: Page, name: string) {
  await nodeByName(page, name).click({ position: { x: 4, y: 4 } });
  await expect(page.getByTestId('inspector')).toContainText(name);
}

async function setField(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

test('build, edit, save, reload and continue editing a landing page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('editor')).toBeVisible();

  // Desktop frame with vertical auto layout.
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-frame-desktop').click();
  await page.getByRole('radio', { name: 'Verticale' }).click();
  await setField(page, 'insp-gap', '0');
  for (let i = 0; i < 4; i++) await setField(page, `insp-pad-${i}`, '0');

  // Header / navigation
  await page.getByTestId('insert-navbar').click();
  await page.getByTestId('insp-sizing-h').selectOption('fill');
  await page.keyboard.press('Escape');
  // Hero: heading, supporting text, CTA button
  await page.getByTestId('insert-section').click();
  await page.getByTestId('insp-sizing-h').selectOption('fill');
  await page.keyboard.press('Escape');
  // Image placeholder
  await page.getByTestId('insert-image').click();
  await page.keyboard.press('Escape');
  // Footer
  await page.getByTestId('insert-container').click();
  await page.getByTestId('insp-sizing-h').selectOption('fill');
  await page.getByTestId('tab-layers').click();
  await page.locator('[data-layer-id]', { hasText: /^Container$/ }).dblclick();
  await page.getByTestId('layer-rename').fill('Footer');
  await page.getByTestId('layer-rename').press('Enter');
  await page.getByTitle(/Elemento semantico/).last().selectOption('footer');
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-text').click();
  await page.getByTestId('insp-characters').fill('© 2026 Brand');
  await page.getByTestId('insp-characters').blur();

  const world = page.locator('[data-canvas-world]');
  await expect(world).toContainText('Progetta interfacce più velocemente');
  await expect(world).toContainText('Inizia ora');
  await expect(world).toContainText('© 2026 Brand');
  await expect(world.locator('[data-node-type="image"]')).toHaveCount(1);

  // 1. Select an individual element on the canvas (double-click drills into the hero).
  const heading = nodeByName(page, 'Heading');
  await heading.dblclick();
  await expect(page.getByTestId('inspector')).toContainText('Heading');

  // 2. Typography
  await setField(page, 'insp-font-size', '64');
  await page.getByTestId('insp-weight').selectOption('900');
  await expect(heading).toHaveCSS('font-size', '64px');
  await expect(heading).toHaveCSS('font-weight', '900');

  // 3. Colors
  await setField(page, 'fill-color-0', '1E40AF');
  await expect(heading).toHaveCSS('color', 'rgb(30, 64, 175)');

  // 4. Spacing on the hero section
  await selectLayer(page, 'Hero section');
  await setField(page, 'insp-gap', '40');
  await expect(nodeByName(page, 'Hero section')).toHaveCSS('gap', '40px');

  // 5. Reorder layers: move the image above the hero (send backward in flow order).
  await selectLayer(page, 'Image');
  const order = async () =>
    page.evaluate(() => {
      const desktop = document.querySelector('[data-canvas-world] > [data-node-id]');
      return [...(desktop?.children ?? [])].map((c) => (c as HTMLElement).dataset.nodeType + ':' + c.textContent?.slice(0, 8));
    });
  const before = await order();
  await page.keyboard.press('ControlOrMeta+[');
  const after = await order();
  expect(after).not.toEqual(before);
  expect(after.indexOf(before[2]!)).toBe(1);

  // 6. Resize a container by dragging its bottom handle.
  await selectLayer(page, 'Footer');
  const footer = nodeByName(page, 'Footer');
  const h0 = (await footer.boundingBox())!.height;
  const handle = page.locator('[data-handle="s"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + 60, { steps: 6 });
  await page.mouse.up();
  const h1 = (await footer.boundingBox())!.height;
  expect(h1).toBeGreaterThan(h0 + 20);

  // Undo/redo the resize
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await footer.boundingBox())!.height).toBeCloseTo(h0, 0);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await footer.boundingBox())!.height).toBeCloseTo(h1, 0);

  // 7. Save (autosave) — 8. reload — 9. reopen
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5000 });
  const url = page.url();
  await page.reload();
  await expect(page.getByTestId('editor')).toBeVisible();
  expect(page.url()).toBe(url);
  const headingAfter = nodeByName(page, 'Heading');
  await expect(headingAfter).toHaveCSS('font-size', '64px');
  await expect(headingAfter).toHaveCSS('color', 'rgb(30, 64, 175)');
  await expect(page.locator('[data-canvas-world]')).toContainText('© 2026 Brand');

  // Back to the project list and reopen it from there.
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('home')).toBeVisible();
  await page.getByTestId('project-card').first().locator('button').first().click();
  await expect(page.getByTestId('editor')).toBeVisible();

  // 10. Continue editing after reopening.
  await nodeByName(page, 'Heading').dblclick();
  await page.getByTestId('insp-characters').fill('Interfacce, più velocemente');
  await page.getByTestId('insp-characters').blur();
  await expect(page.locator('[data-canvas-world]')).toContainText('Interfacce, più velocemente');
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5000 });
  await page.reload();
  await expect(page.locator('[data-canvas-world]')).toContainText('Interfacce, più velocemente');

  expect(errors).toEqual([]);
});

test('draws shapes with tools, edits text inline and supports pan/zoom', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const canvas = page.locator('[data-canvas-root]');
  const box = (await canvas.boundingBox())!;

  // Draw a frame with the frame tool.
  await page.keyboard.press('f');
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-canvas-world] [data-node-type="frame"]')).toHaveCount(1);

  // Draw a rectangle inside the frame.
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 220, { steps: 4 });
  await page.mouse.up();
  const rect = page.locator('[data-canvas-world] [data-node-type="frame"] > [data-node-type="rect"]');
  await expect(rect).toHaveCount(1);

  // Move it with the mouse.
  const r0 = (await rect.boundingBox())!;
  await page.mouse.move(r0.x + 20, r0.y + 20);
  await page.mouse.down();
  await page.mouse.move(r0.x + 80, r0.y + 60, { steps: 5 });
  await page.mouse.up();
  const r1 = (await rect.boundingBox())!;
  expect(r1.x).toBeGreaterThan(r0.x + 40);

  // Text tool: click, type, commit.
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 200, box.y + 330);
  await page.keyboard.type('Ciao flö');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-canvas-world] [data-node-type="text"]')).toHaveText('Ciao flö');

  // Duplicate + delete
  await page.locator('[data-canvas-world] [data-node-type="text"]').click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('[data-canvas-world] [data-node-type="text"]')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-canvas-world] [data-node-type="text"]')).toHaveCount(1);

  // Zoom with ctrl+wheel changes the zoom indicator.
  const z0 = await page.getByTestId('zoom-menu').textContent();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect(page.getByTestId('zoom-menu')).not.toHaveText(z0!);
});
