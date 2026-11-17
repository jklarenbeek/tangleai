/**
 * Calculator and Converter on the desktop, in a real browser: Jaren's
 * calculator computes in its window and switches modes; Converter opens it in
 * the converter mode alone and converts with the offline rate table when the
 * public tickers cannot be reached.
 */
import { test, expect } from './playwright.mjs';

async function desktop(page) {
  // the public rate tickers are never reached from a test: the offline table answers
  await page.route(/coingecko|binance/, route => route.abort());
  await page.addInitScript(() => { localStorage.setItem('tangle-os-welcomed', '1'); });
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs);
}

test('Calculator computes and changes mode in its window', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('calculator'));
  const calc = page.locator('.tos-window[data-module="calculator"]');
  for (const key of ['7', '×', '6', '=']) await calc.getByRole('button', { name: key, exact: true }).first().click();
  await expect(calc.locator('.tos-content')).toContainText('42');
  await calc.getByRole('button', { name: 'Scientific' }).click();
  await expect(calc.getByRole('button', { name: 'sin', exact: true })).toBeVisible();
  await expect(page.locator('.tos-dock-item[data-module="calculator"]')).toHaveClass(/is-running/);
});

test('Converter opens in the converter mode alone and converts offline', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('converter'));
  const converter = page.locator('.tos-window[data-module="converter"]');
  await expect(converter.locator('.calc-modes')).toBeHidden();
  const dimension = converter.getByRole('combobox').first();
  await expect(dimension).toBeVisible();
  await expect(converter.locator('.tos-content')).toContainText(/\d/);
});
