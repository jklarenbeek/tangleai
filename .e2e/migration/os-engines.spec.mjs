/**
 * Charts and Collections on the desktop, in a real browser. Charts draws a
 * run of the memory loop as it arrives and redraws on another run; its own
 * chart is a JSON document that redraws only when it is a valid definition.
 * Collections scrolls ten thousand rows held in memory, then the same grid
 * over a SQLite database opened in the page.
 */
import { test, expect } from './playwright.mjs';

async function desktop(page) {
  await page.addInitScript(() => { localStorage.setItem('tangle-os-welcomed', '1'); });
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs);
}

test('Charts draws the points a run measures, and draws them again on another run', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('charts'));
  const win = page.locator('.tos-window[data-module="charts"]');
  const status = win.locator('.engines-status');
  // the window opens on a run: six observations, each a step on both charts
  await expect(status).toHaveAttribute('data-points', /^[1-9]\d*$/, { timeout: 20_000 });
  const points = Number(await status.getAttribute('data-points'));
  expect(points).toBeGreaterThanOrEqual(12);
  await expect(win.locator('[data-chart="growth"] svg circle')).not.toHaveCount(0);
  await expect(win.locator('[data-chart="stages"] svg rect').first()).toBeVisible();
  const before = await win.locator('[data-chart="stages"] svg').innerHTML();

  await win.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect(status).toHaveAttribute('data-points', String(points), { timeout: 20_000 });
  await expect(win.getByRole('button', { name: 'Run again', exact: true })).toBeEnabled();
  // the second run's milliseconds are its own: the stacked bars are redrawn from them
  await expect.poll(() => win.locator('[data-chart="stages"] svg').innerHTML()).not.toBe(before);
});

test('the own chart redraws only for a valid definition, and keeps the last one otherwise', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('charts'));
  const win = page.locator('.tos-window[data-module="charts"]');
  const editor = win.locator('#engines-definition');
  const check = win.locator('.engines-check');
  const own = win.locator('[data-chart="own"]');
  // the first run fills the document with its own numbers
  await expect(editor).toHaveValue(/"type": "bar"/, { timeout: 20_000 });
  await expect(own.locator('svg')).toBeVisible();

  await editor.fill('{ "type": "pie", ');
  await expect(check).toHaveAttribute('data-check', 'json');
  await expect(own.locator('svg')).toBeVisible();

  await editor.fill(JSON.stringify({ type: 'bar', categories: 'x', series: [] }));
  await expect(check).toHaveAttribute('data-check', 'definition');
  await expect(win.locator('.engines-issues li').first()).toContainText('/categories');
  await expect(own.locator('svg')).toBeVisible();

  await editor.fill(JSON.stringify({ type: 'pie', title: 'Parts of a whole', slices: [{ label: 'a', value: 2 }, { label: 'b', value: 3 }] }));
  await expect(check).toHaveAttribute('data-check', 'valid');
  await expect(own.locator('svg')).toContainText('Parts of a whole');

  // the run's numbers come back on request
  await win.getByRole('button', { name: 'Use the latest run\'s numbers', exact: true }).click();
  await expect(editor).toHaveValue(/"type": "bar"/);
  await expect(own.locator('svg')).not.toContainText('Parts of a whole');
});

test('Collections scrolls ten thousand rows in memory, then the rows of a SQLite database', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('collections'));
  const win = page.locator('.tos-window[data-module="collections"]');
  const status = win.locator('.engines-status');
  await expect(status).toHaveAttribute('data-total', '10000', { timeout: 20_000 });
  await expect(win.locator('.jc-cell').first()).toContainText('Row 1');
  // only the rows in view are mounted, wherever the grid is scrolled
  const viewport = win.locator('.jc-viewport');
  await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(win.locator('.jc-cell', { hasText: 'Row 10,000' })).toBeVisible();
  await expect(status).toContainText('to 10,000 in view');
  expect(await win.locator('.jc-row').count()).toBeLessThan(100);

  await win.locator('button[data-source="sqlite"]').click();
  await expect(win.locator('button[data-source="sqlite"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(status).toHaveAttribute('data-total', '1000', { timeout: 30_000 });
  await expect(win.locator('.jc-cell', { hasText: 'Stored row 1' }).first()).toBeVisible();
});
