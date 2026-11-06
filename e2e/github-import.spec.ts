import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SHA = 'a'.repeat(40);
const fixture = (name: string) => readFileSync(new URL(`../src/core/__tests__/fixtures/${name}.txt`, import.meta.url), 'utf8');
const FILES: Record<string, string> = {
  'src/components/hero.tsx': fixture('hero.tsx').replace("from './button'", "from '@/components/ui/button'"),
  'src/components/ui/button.tsx': fixture('button.tsx'),
  'src/lib/utils.ts': "import { clsx } from 'clsx';\nimport { twMerge } from 'tailwind-merge';\nexport function cn(...inputs) { return twMerge(clsx(inputs)); }\n",
};

test('imports React components from GitHub as editable flö layers (mocked API)', async ({ page }) => {
  const errors: string[] = [];
  const requests: { url: string; auth: string | undefined }[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push({ url: url.href, auth: route.request().headers().authorization });
    const p = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    if (p === '/repos/acme/ui') return json({ default_branch: 'main', private: false });
    if (p === '/repos/acme/ui/commits/main') return json({ sha: SHA });
    if (p === `/repos/acme/ui/git/trees/${SHA}`) return json({ tree: Object.keys(FILES).map((path) => ({ path, type: 'blob', size: FILES[path]!.length })).concat([{ path: 'README.md', type: 'blob', size: 10 }]) });
    if (p === '/repos/acme/ui/license') return json({ license: { spdx_id: 'MIT' } });
    const m = /^\/repos\/acme\/ui\/contents\/(.+)$/.exec(p);
    if (m && url.searchParams.get('ref') === SHA && FILES[decodeURIComponent(m[1]!)]) return route.fulfill({ status: 200, contentType: 'text/plain', body: FILES[decodeURIComponent(m[1]!)]!, headers: { 'access-control-allow-origin': '*' } });
    return json({ message: 'Not Found' }, 404);
  });

  await page.goto('/');
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-insert').click();
  await page.getByTestId('insert-frame-desktop').click();
  await expect(page.getByTestId('insert-github')).toBeVisible();
  await page.getByTestId('gh-open').click();

  // Invalid URLs are rejected before any request.
  await page.getByTestId('gh-url').fill('not a url');
  await page.getByTestId('gh-load').click();
  await expect(page.getByTestId('gh-error')).toBeVisible();
  expect(requests).toHaveLength(0);

  await page.getByTestId('gh-url').fill('https://github.com/acme/ui/tree/main/src/components');
  await page.getByTestId('gh-load').click();
  await expect(page.getByTestId('gh-license')).toContainText('MIT');
  // Only source files under the folder are listed; the first component file is preselected.
  await expect(page.getByTestId('gh-file-src/components/hero.tsx')).toBeVisible();
  await expect(page.getByTestId('gh-file-src/lib/utils.ts')).toHaveCount(0);
  await expect(page.getByTestId('gh-file-src/components/hero.tsx')).toBeChecked();
  await page.getByTestId('gh-analyze').click();

  // Hero is exported (checked); FeatureCard is internal (unchecked). Button came in as a dependency.
  await expect(page.getByTestId('gh-comp-Hero')).toBeChecked();
  await expect(page.getByTestId('gh-comp-FeatureCard')).not.toBeChecked();
  await page.getByTestId('gh-import').click();
  await expect(page.getByTestId('gh-result')).toContainText('1');
  await expect(page.getByTestId('gh-result')).toContainText('Rocket');
  // The dependency (button.tsx via the @/ alias) was resolved and downloaded at the pinned commit.
  expect(requests.some((r) => r.url.includes('/contents/src/components/ui/button.tsx') && r.url.includes(`ref=${SHA}`))).toBe(true);
  expect(requests.every((r) => r.auth === undefined)).toBe(true);

  await page.getByTestId('gh-goto').click();
  const world = page.locator('[data-canvas-world]');
  const main = world.locator('[data-component="main"]');
  await expect(main).toHaveCount(1);
  await expect(main).toContainText('Costruisci più in fretta');
  await expect(main).toContainText('Pagine pronte in pochi minuti.');
  await expect(main).toContainText('Inizia');
  await expect(main.locator('[data-node-type="text"]').first()).toBeVisible();
  // Mobile-first classes became responsive overrides (md:text-6xl → 60px desktop).
  const title = main.locator('[data-node-type="text"]', { hasText: 'Costruisci più in fretta' });
  await expect(title).toHaveCSS('font-size', '60px');

  // Back on the first page: the Insert panel lists the imported component; a click inserts an editable copy.
  await page.getByTestId('pages-list').locator('li').first().click();
  await page.getByTestId('tab-insert').click();
  await world.locator('[data-node-type="frame"]').first().click({ position: { x: 20, y: 20 } });
  await page.getByTestId('insert-gh-Hero').click();
  await expect(world.locator('[data-name="Hero"]')).toHaveCount(1);
  await expect(world.locator('[data-name="Hero"]')).toContainText('Ogni livello è modificabile.');
  await expect(world.locator('[data-component="main"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
