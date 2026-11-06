import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * Milestone 6 acceptance: a page designed in flö is exported as React, and the generated
 * project installs, type-checks, builds and runs on its own (prototype navigation included).
 */
test('exported React project builds and runs independently', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-insert').click();

  // Landing page: vertical auto layout with navigation, hero (heading, text, CTA), image, footer.
  await page.getByTestId('insert-frame-desktop').click();
  await page.getByRole('radio', { name: 'Verticale' }).click();
  await page.getByTestId('insert-navbar').click();
  await page.getByTestId('insp-sizing-h').selectOption('fill');
  await page.keyboard.press('Escape');
  await page.getByTestId('insert-section').click();
  await page.getByTestId('insp-sizing-h').selectOption('fill');
  await page.keyboard.press('Escape');
  await page.getByTestId('insert-image').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('insert-container').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Second screen and a prototype link from the CTA.
  await page.getByTestId('insert-frame-laptop').click();
  await page.getByTestId('insert-text').click();
  await page.getByTestId('insp-characters').fill('Grazie per l’interesse');
  await page.getByTestId('insp-characters').blur();
  await page.keyboard.press('Shift+1');
  const world = page.locator('[data-canvas-world]');
  await world.locator('[data-name="Desktop"] [data-name="Label"]').dblclick();
  await expect(page.getByTestId('inspector')).toContainText('Button');
  await page.getByTestId('proto-add').click();
  await expect(page.getByTestId('proto-destination').locator('option:checked')).toHaveText('Laptop');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // Export (whole page) as a React project.
  await page.getByTestId('export-menu').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-react').click();
  const zipPath = await (await dl).path();

  const dir = mkdtempSync(join(tmpdir(), 'flo-react-'));
  let server: ChildProcess | null = null;
  try {
    execSync(`unzip -q "${zipPath}" -d "${dir}"`);
    const root = join(dir, readdirSync(dir)[0]!);
    execSync('npm install --no-audit --no-fund --prefer-offline --loglevel=error', { cwd: root, stdio: 'pipe', timeout: 240_000 });
    execSync('npm run build', { cwd: root, stdio: 'pipe', timeout: 120_000 }); // tsc --noEmit && vite build

    server = spawn('npx', ['vite', 'preview', '--port', '4190', '--strictPort'], { cwd: root, stdio: 'pipe', detached: true });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview did not start')), 30_000);
      server!.stdout!.on('data', (d: Buffer) => {
        if (d.toString().includes('4190')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    const app = await browser.newPage();
    const errors: string[] = [];
    app.on('pageerror', (e) => errors.push(e.message));
    await app.goto('http://localhost:4190/');
    await expect(app.locator('h1')).toHaveText('Progetta interfacce più velocemente');
    await expect(app.locator('nav')).toContainText('Prodotto');
    await expect(app.locator('section')).toHaveCSS('display', 'flex');
    // The CTA is a real, keyboard-accessible button that navigates to the second screen.
    const cta = app.getByRole('button', { name: 'Inizia ora' });
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(app).toHaveURL(/#\/Laptop$/);
    await expect(app.getByText('Grazie per l’interesse')).toBeVisible();
    expect(errors).toEqual([]);
    await app.close();
  } finally {
    // Kill the whole process group (npx → vite), not just npx.
    if (server?.pid) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        server.kill();
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
