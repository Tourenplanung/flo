import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

async function newProjectWithDesign(page: Page) {
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-frame-desktop').click();
  await page.getByTestId('insert-section').click();
}

const node = (page: Page, kind: string) => page.locator(`[data-wf-node="${kind}"]`).first();

test('workflow: reference existing design, connect nodes by hand, run checks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProjectWithDesign(page);

  await page.getByTestId('mode-workflow').click();
  await page.getByTestId('wf-new').click();
  await page.getByTestId('wf-add-design-input').click();
  await page.getByTestId('wf-add-a11y-check').click();
  await expect(page.locator('[data-wf-node]')).toHaveCount(2);

  // Drag from the design output port to the a11y input port.
  const out = node(page, 'design-input').locator('.react-flow__handle.source');
  const inp = node(page, 'a11y-check').locator('.react-flow__handle.target');
  const a = (await out.boundingBox())!;
  const b = (await inp.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  await page.getByTestId('wf-run-all').click();
  await expect(node(page, 'a11y-check')).toHaveAttribute('data-status', 'done');
  await node(page, 'a11y-check').click();
  await expect(page.getByTestId('wf-report')).toContainText('WCAG AA');

  // AI nodes are clearly unavailable and never produce fake output.
  await page.getByTestId('wf-add-ux-analysis').click();
  await expect(page.getByTestId('wf-unavailable')).toContainText('provider AI');

  // Clicking a report issue (if any) or the design output opens the design canvas.
  await node(page, 'design-input').click();
  await page.getByTestId('wf-open-canvas').click();
  await expect(page.getByTestId('mode-design')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('inspector')).toContainText('Desktop');
  expect(errors).toEqual([]);
});

test('workflow: brief-to-design template generates editable screens, caches, persists and exports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('mode-workflow').click();
  await page.getByTestId('wf-from-template').click();
  await page.getByTestId('wf-template-brief-to-design').click();
  await expect(page.locator('[data-wf-node]')).toHaveCount(10);

  await page.getByTestId('wf-run-all').click();
  for (const kind of ['brief-input', 'sitemap', 'wireframe', 'design-system', 'apply-styles', 'responsive-adapter', 'a11y-check', 'html-export', 'canvas-output']) {
    await expect(node(page, kind)).toHaveAttribute('data-status', 'done');
  }
  await node(page, 'sitemap').click();
  await expect(page.getByTestId('wf-sitemap-preview')).toContainText('Contatti');

  // HTML export
  await node(page, 'html-export').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('wf-code-download').click();
  const html = readFileSync((await (await dl).path())!, 'utf8');
  expect(html).toContain('<header');
  expect(html).toContain('<h1');
  expect(html).toContain('display: flex');

  // Results are real, editable layers in the design document.
  await node(page, 'canvas-output').click();
  await page.getByTestId('wf-open-canvas').click();
  await expect(page.getByTestId('pages-list')).toContainText('Wireframe');
  const frames = page.locator('[data-canvas-world] > [data-node-type="frame"]');
  await expect(frames).toHaveCount(15); // 5 wireframes + 5 styled + 5 mobile
  await expect(page.locator('[data-canvas-world]')).toContainText('Chi siamo');

  // Reload: workflow + execution cache persist; re-running does not duplicate frames.
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', { timeout: 5000 });
  await page.reload();
  await page.getByTestId('mode-workflow').click();
  await expect(page.locator('[data-wf-node]')).toHaveCount(10);
  await page.getByTestId('wf-run-all').click();
  await expect(node(page, 'wireframe')).toHaveAttribute('data-status', 'cached');
  await expect(node(page, 'responsive-adapter')).toHaveAttribute('data-status', 'cached');

  // Changing a parameter regenerates downstream results, replacing the previous frames.
  await node(page, 'design-system').click();
  const primary = page.getByTestId('wf-param-primary');
  await primary.fill('C2185B');
  await primary.press('Enter');
  await expect(node(page, 'apply-styles')).toHaveAttribute('data-status', 'stale');
  await page.getByTestId('wf-run-all').click();
  await expect(node(page, 'apply-styles')).toHaveAttribute('data-status', 'done');
  await expect(node(page, 'wireframe')).toHaveAttribute('data-status', 'cached');
  await page.getByTestId('mode-design').click();
  await page.getByTestId('pages-list').getByText('Wireframe').click();
  await expect(frames).toHaveCount(15);
  expect(errors).toEqual([]);
});
