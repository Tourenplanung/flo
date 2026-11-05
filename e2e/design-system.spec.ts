import { expect, test, type Page } from '@playwright/test';

const world = (page: Page) => page.locator('[data-canvas-world]');

async function setField(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

test('tokens, components with overrides, breakpoints, constraints and persistent history', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-frame-desktop').click();
  await page.getByTestId('insert-card').click();

  /* ---------- Components & instances ---------- */
  await page.getByTestId('comp-create').click();
  await page.getByTestId('comp-instance').click();
  const instance = world(page).locator('[data-node-type="instance"]');
  await expect(instance).toHaveCount(1);
  // Override the title inside the instance.
  await instance.locator('[data-name="Title"]').dblclick();
  await expect(page.getByTestId('instance-layer-inspector')).toBeVisible();
  await page.getByTestId('inst-layer-characters').fill('Offerta speciale');
  await page.getByTestId('inst-layer-characters').blur();
  await expect(instance).toContainText('Offerta speciale');
  // Edit the main component: the change propagates, the override is kept.
  const main = world(page).locator('[data-component="main"]');
  await main.locator('[data-name="Description"]').dblclick();
  await page.getByTestId('insp-characters').fill('Testo aggiornato nel componente');
  await page.getByTestId('insp-characters').blur();
  await expect(instance).toContainText('Testo aggiornato nel componente');
  await expect(instance).toContainText('Offerta speciale');

  /* ---------- Design tokens ---------- */
  await main.click({ position: { x: 40, y: 6 } });
  await page.getByTestId('tab-tokens').click();
  await page.getByTestId('tok-colors-add').click();
  await expect(page.getByTestId('token-color')).toHaveCount(1);
  await page.getByTestId('token-select-fill').selectOption({ label: 'color' });
  const tokenHex = page.getByTestId('token-color').locator('input[maxlength="7"]');
  await tokenHex.click();
  await tokenHex.press('ControlOrMeta+a');
  await tokenHex.pressSequentially('0B5FFF');
  await tokenHex.press('Enter');
  // Main component and its instance both follow the token.
  await expect(main).toHaveCSS('background-color', 'rgb(11, 95, 255)');
  await expect(instance).toHaveCSS('background-color', 'rgb(11, 95, 255)');

  /* ---------- Breakpoints ---------- */
  const desktop = world(page).locator(':scope > [data-node-type="frame"]').first();
  const selectDesktop = () => page.locator('[data-frame-label]').first().click();
  await selectDesktop();
  await page.getByTestId('bp-mobile').click();
  await expect(desktop).toHaveCSS('width', '390px');
  await expect(page.getByTestId('bp-banner')).toBeVisible();
  await setField(page, 'insp-h', '700');
  await expect(desktop).toHaveCSS('height', '700px');
  await page.getByTestId('bp-base').click();
  await expect(desktop).toHaveCSS('width', '1440px');
  await expect(desktop).toHaveCSS('height', '1024px');

  /* ---------- Constraints ---------- */
  await main.click({ position: { x: 40, y: 6 } });
  await page.getByTestId('cons-h').selectOption('end');
  const before = (await main.boundingBox())!;
  const frameBefore = (await desktop.boundingBox())!;
  await selectDesktop();
  await setField(page, 'insp-w', '1640');
  const after = (await main.boundingBox())!;
  const frameAfter = (await desktop.boundingBox())!;
  // Pinned to the right edge: moves by the same amount the frame grew.
  expect(Math.round(after.x - before.x)).toBe(Math.round(frameAfter.width - frameBefore.width));

  /* ---------- Persistent history ---------- */
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5000 });
  await page.reload();
  await expect(world(page).locator('[data-node-type="instance"]')).toContainText('Offerta speciale');
  await page.getByTestId('tab-history').click();
  const entries = page.getByTestId('history-entry');
  expect(await entries.count()).toBeGreaterThan(5);
  // Undo after reload restores the previous width.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(world(page).locator(':scope > [data-node-type="frame"]').first()).toHaveCSS('width', '1440px');
  expect(errors).toEqual([]);
});
