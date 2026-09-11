// tangle pages e2e — the in-browser pipeline demo, for real.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
const jarenRequire = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../jarenjs/package.json', import.meta.url));
const { chromium } = jarenRequire('playwright-core');

const base = process.env.PAGES_URL ?? 'http://127.0.0.1:4715';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const fail = async (msg) => {
  await page.screenshot({ path: new URL('./pages-fail.png', import.meta.url).pathname, fullPage: true }).catch(() => {});
  console.error('FAIL:', msg);
  process.exit(1);
};
page.on('pageerror', (e) => void fail(`pageerror: ${e.message}`));

await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero h1', { timeout: 8000 }).catch(() => fail('hero missing'));
await page.waitForSelector('.dag svg', { timeout: 8000 }).catch(() => fail('dag svg missing'));

await page.waitForSelector('[data-jaren-version="0.83.2"]');
const measuredRows = await page.locator('.history-table tbody tr').count();
if (measuredRows !== 2) await fail(`expected Node and Bun measurements, got ${measuredRows}`);
const paidRows = await page.locator('.paid-table tbody tr').count();
if (paidRows !== 6) await fail(`expected six paid answer strategies, got ${paidRows}`);
const { bounded } = JSON.parse(await readFile(new URL('../benchmark/results/jaren-integration.json', import.meta.url), 'utf8'));
await page.waitForSelector(`[data-bounded-policy="${bounded.policy}"]`);
const boundedRow = page.locator('.paid-table tbody tr').filter({ hasText: 'Bounded agent' });
const cells = await boundedRow.locator('td').allTextContents();
if (cells[1] !== `${bounded.current.valid}/${bounded.current.planned}` || cells[2] !== bounded.current.f1.toFixed(3))
  await fail(`bounded measurements are stale: ${JSON.stringify(cells)}`);
const reportLink = page.locator('a[href$="/docs/BOUNDED_AGENT_BENCHMARK.md"]');
if (await reportLink.count() !== 1) await fail('bounded comparison report link missing');
await page.click('button:has-text("run the loop")');
await page.waitForSelector('.node.ok', { timeout: 8000 }).catch(() => fail('no ok node'));
const okNodes = await page.locator('.node.ok').count();
if (okNodes < 6) await fail(`only ${okNodes} ok nodes`);
await page.waitForSelector('.report', { timeout: 4000 }).catch(() => fail('no report'));

await page.fill('.ask-input', 'what is the current api rate limit?');
await page.click('button:has-text("recall")');
await page.waitForSelector('.hit', { timeout: 6000 }).catch(() => fail('no recall hits'));
const top = await page.locator('.hit-text').first().innerText();
if (!top.includes('500')) await fail(`top hit not the current figure: ${top}`);
const body = await page.locator('.answer').innerText();
if (body.includes('100 requests')) await fail('the superseded figure surfaced');
await page.screenshot({ path: new URL('./pages.png', import.meta.url).pathname, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) await fail('mobile page overflows horizontally');
console.log('PASS — integration version, benchmark rows, mobile layout and top recall:', top);
await browser.close();
process.exit(0);
