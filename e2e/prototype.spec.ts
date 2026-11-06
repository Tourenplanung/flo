import { expect, test } from '@playwright/test';

test('prototype: link screens, open overlays and navigate in the player', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-insert').click();

  // Three screens, each with a button.
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

  await page.keyboard.press('Shift+1'); // zoom to fit all screens
  const world = page.locator('[data-canvas-world]');
  // Home button → navigate to Dettaglio (default destination).
  await world.locator('[data-name="Home"] [data-name="Button"]').click();
  await page.getByTestId('proto-add').click();
  await expect(page.getByTestId('proto-destination')).toHaveValue(/.+/);
  await expect(page.getByTestId('proto-destination').locator('option:checked')).toHaveText('Dettaglio');
  await expect(page.locator('[data-testid="proto-connections"] g path')).toHaveCount(1);

  // Dettaglio button → open Menu as overlay.
  await world.locator('[data-name="Dettaglio"] [data-name="Button"]').click();
  await page.getByTestId('proto-add').click();
  await page.getByTestId('proto-action').selectOption('open-overlay');
  await page.getByTestId('proto-destination').selectOption({ label: 'Menu' });

  // Make the menu a small panel.
  await page.locator('[data-frame-label]', { hasText: 'Menu' }).click();
  for (const [id, v] of [['insp-w', '300'], ['insp-h', '320']] as const) {
    await page.getByTestId(id).click();
    await page.getByTestId(id).fill(v);
    await page.getByTestId(id).press('Enter');
  }

  // Play from Home.
  await world.locator('[data-name="Home"] [data-name="Button"]').click();
  await page.getByTestId('proto-play').click();
  const player = page.getByTestId('prototype-player');
  await expect(player).toBeVisible();
  const view = page.getByTestId('proto-screen-view');
  await expect(view).toHaveAttribute('data-screen', 'Home');
  await view.locator('[data-name="Button"]').click();
  await expect(view).toHaveAttribute('data-screen', 'Dettaglio');

  await view.locator('[data-name="Button"]').click();
  await expect(page.getByTestId('proto-overlay')).toHaveCount(1);
  // Clicking outside the overlay closes it.
  const box = (await page.getByTestId('proto-overlay').boundingBox())!;
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.getByTestId('proto-overlay')).toHaveCount(0);

  // Back with the keyboard, then exit.
  await page.keyboard.press('ArrowLeft');
  await expect(view).toHaveAttribute('data-screen', 'Home');
  await page.keyboard.press('Escape');
  await expect(player).toHaveCount(0);

  // Interactions persist with the project.
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5000 });
  await page.reload();
  await page.keyboard.press('Shift+1');
  await page.locator('[data-canvas-world] [data-name="Home"] [data-name="Button"]').click();
  await expect(page.getByTestId('proto-interaction')).toHaveCount(1);
  expect(errors).toEqual([]);
});
