/**
 * Docs and Benchmarks on the desktop, in a real browser: Docs lists the
 * repository's documents, opens one, and follows a link inside it to another
 * document without leaving the desktop; Benchmarks opens a report and draws
 * its headline chart from the results file the report was generated from.
 */
import { test, expect } from './playwright.mjs';
import { readFileSync } from 'node:fs';

const recall = JSON.parse(readFileSync(new URL('../../benchmark/results/locomo-recall.json', import.meta.url), 'utf8'));

async function desktop(page) {
  await page.addInitScript(() => { localStorage.setItem('tangle-os-welcomed', '1'); });
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs);
}

test('Docs opens a document and follows its links inside the window', async ({ page }) => {
  await desktop(page);
  const start = page.url();
  await page.evaluate(() => window.tangleOs.desktop.open('docs'));
  const docs = page.locator('.tos-window[data-module="docs"]');
  const architecture = docs.locator('.tos-reader-item[data-path="docs/ARCHITECTURE.md"]');
  await expect(architecture).toBeVisible();
  await architecture.click();
  await expect(docs.locator('.tos-reader-article h1')).toHaveText(/Architecture/);
  await expect(architecture).toHaveAttribute('aria-current', 'page');
  // a link to another document of the reader opens it here
  const link = docs.locator('.tos-reader-article a[data-doc="docs/ROADMAP.md"]').first();
  await link.click();
  await expect(docs.locator('.tos-reader-item[data-path="docs/ROADMAP.md"]')).toHaveAttribute('aria-current', 'page');
  await expect(docs.locator('.tos-reader-article h1')).toHaveText(/Roadmap/);
  expect(page.url()).toBe(start);
  // the web opens in a new tab, never in the desktop
  const external = docs.locator('.tos-reader-article a[href^="https://"]').first();
  if (await external.count()) await expect(external).toHaveAttribute('target', '_blank');
});

test('Benchmarks draws a report\'s headline from its measured results', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('benchmarks'));
  const bench = page.locator('.tos-window[data-module="benchmarks"]');
  await bench.locator('.tos-reader-item[data-path="docs/LOCOMO_RECALL.md"]').click();
  await expect(bench.locator('.tos-reader-article h1')).toBeVisible();
  const chart = bench.locator('.tos-reader-chart');
  await expect(chart.locator('svg')).toBeVisible();
  await expect(chart.locator('figcaption')).toContainText('locomo-recall.json');
  // every category of the chart is a row of the results file, in its order
  const svg = await chart.locator('svg').textContent();
  for (const row of recall.rows) expect(svg).toContain(row.key);
  // every mark carries a measured value exactly as the results file holds it
  const titles = await chart.locator('svg title').allTextContents();
  for (const row of recall.rows) for (const k of recall.config.ks) {
    const measured = `${row.key}: ${row.recall[String(k)].overall}`;
    expect(titles.some(text => text.endsWith(measured)), measured).toBe(true);
  }
});
