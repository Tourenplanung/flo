import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('group, ungroup, copy/paste, pages, language and export/import', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-frame-desktop').click();
  await page.getByTestId('insert-rect').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('insert-ellipse').click();

  const world = page.locator('[data-canvas-world]');
  // Select both shapes with shift-click and group them.
  await world.locator('[data-node-type="ellipse"]').click();
  await world.locator('[data-node-type="rect"]').click({ modifiers: ['Shift'], position: { x: 3, y: 3 } });
  await expect(page.getByTestId('inspector')).toContainText('2');
  await page.keyboard.press('ControlOrMeta+g');
  await expect(world.locator('[data-node-type="group"] > [data-node-type="rect"]')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+Shift+g');
  await expect(world.locator('[data-node-type="group"]')).toHaveCount(0);

  // Copy / paste
  await world.locator('[data-node-type="ellipse"]').click();
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(world.locator('[data-node-type="ellipse"]')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(world.locator('[data-node-type="ellipse"]')).toHaveCount(1);

  // Pages
  await page.getByTestId('add-page').click();
  await expect(page.getByTestId('pages-list').locator('li')).toHaveCount(2);
  await expect(world.locator('[data-node-id]')).toHaveCount(0);
  await page.getByTestId('pages-list').locator('li').first().click();
  await expect(world.locator('[data-node-type="ellipse"]')).toHaveCount(1);

  // Export downloads a .flo.json bundle
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-menu').click();
  await page.getByTestId('export-project').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.flo\.json$/);
  const path = await download.path();
  // Export must reflect the live document even before autosave has run.
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as { project: { pages: unknown[]; nodes: Record<string, { type: string }> } };
  expect(bundle.project.pages).toHaveLength(2);
  expect(Object.values(bundle.project.nodes).map((n) => n.type).sort()).toEqual(['ellipse', 'frame', 'rect']);

  // Language switch on the home screen, then import the exported file.
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5000 });
  await page.getByTestId('go-home').click();
  await page.getByTestId('language').selectOption('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your projects');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import' }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('[data-canvas-world] [data-node-type="ellipse"]')).toHaveCount(1);
  await page.getByTestId('go-home').click();
  await expect(page.getByTestId('project-card')).toHaveCount(2);

  expect(errors).toEqual([]);
});
