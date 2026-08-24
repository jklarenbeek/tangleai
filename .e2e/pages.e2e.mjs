// tangle pages e2e — the in-browser pipeline demo, for real.
import { createRequire } from 'node:module';
const jarenRequire = createRequire('/home/joham/projects/jp/jarenjs/package.json');
const { chromium } = jarenRequire('playwright-core');

const base = process.env.PAGES_URL ?? 'http://127.0.0.1:4715';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const fail = async (msg) => {
  await page.screenshot({ path: '/home/joham/projects/jp/tangleai/.e2e/pages-fail.png', fullPage: true }).catch(() => {});
  console.error('FAIL:', msg);
  process.exit(1);
};
page.on('pageerror', (e) => void fail(`pageerror: ${e.message}`));

await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero h1', { timeout: 8000 }).catch(() => fail('hero missing'));
await page.waitForSelector('.dag svg', { timeout: 8000 }).catch(() => fail('dag svg missing'));

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
await page.screenshot({ path: '/home/joham/projects/jp/tangleai/.e2e/pages.png', fullPage: true });
console.log('PASS — top recall:', top);
await browser.close();
process.exit(0);
