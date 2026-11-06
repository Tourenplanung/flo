import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test('phone-sized screens: panels become drawers, design and workflow stay usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-project').click();

  // Side panels are hidden; the canvas gets the whole width.
  const canvas = (await page.locator('[data-canvas-root]').boundingBox())!;
  expect(canvas.width).toBeGreaterThan(380);
  await expect(page.getByTestId('compact-tools')).toBeVisible();

  // Left drawer → insert a screen and a button; the drawer closes to show the result.
  await page.getByTestId('drawer-left').click();
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-frame-mobile').click();
  await expect(page.locator('[data-drawer="left"]')).toHaveCount(0);
  await page.getByTestId('drawer-left').click();
  await page.getByTestId('insert-button').click();
  await expect(page.locator('[data-canvas-world] [data-name="Button"]')).toHaveCount(1);

  // Right drawer → inspector of the selection.
  await page.getByTestId('drawer-right').click();
  await expect(page.locator('[data-drawer="right"]')).toContainText('Prototipo');
  await page.getByTestId('drawer-close-right').click();
  await expect(page.locator('[data-drawer="right"]')).toHaveCount(0);

  // Workflow mode: node catalog in a drawer, canvas visible, nodes can be added.
  await page.getByTestId('mode-workflow').click();
  await expect(page.getByTestId('workflow-view')).toBeVisible();
  await page.getByTestId('drawer-left').click();
  await page.getByTestId('wf-new').click();
  await page.getByTestId('wf-add-brief-input').click();
  await expect(page.locator('[data-drawer="left"]')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  expect(errors).toEqual([]);
});
