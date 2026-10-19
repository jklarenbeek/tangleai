// Radiant OS (Tangle edition) e2e — boot, the human's verdict, the oracle
// hearing the human, and the OS database, in a real browser.
import { createRequire } from 'node:module';
const jarenRequire = createRequire(process.env.PLAYWRIGHT_PACKAGE ?? new URL('../../jarenjs/package.json', import.meta.url));
const { chromium } = jarenRequire('playwright-core');

const base = process.env.PAGES_URL ?? 'http://127.0.0.1:4715';
// a qualified browser outside Playwright's own cache, when the host has one
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const fail = async (msg) => {
  await page.screenshot({ path: new URL('./os-fail.png', import.meta.url).pathname, fullPage: true }).catch(() => {});
  console.error('FAIL:', msg);
  process.exit(1);
};
page.on('pageerror', (e) => void fail(`pageerror: ${e.message}`));
const pill = (label) => page.locator('.os-pill', { hasText: label }).locator('.os-pill-value').textContent();

await page.goto(base + '/os/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.os[data-phase="idle"]', { timeout: 10000 }).catch(() => fail('the OS did not boot'));
await page.waitForSelector('.os-stage canvas', { timeout: 4000 }).catch(() => fail('no stage canvas'));
await page.waitForTimeout(1200);
if (!(Number(await pill('tick')) > 5)) await fail('the machine is not running');
if (await pill('oracle') !== 'scripted') await fail(`unexpected oracle seat: ${await pill('oracle')}`);

await page.fill('#os-say-input', 'more symmetry, please');
await page.click('button:has-text("Say")');
await page.click('button:has-text("Convene now")');
await page.waitForSelector('.os[data-phase="veto"]', { timeout: 20000 }).catch(() => fail('no verdict'));
const heard = await page.locator('.os-proposal', { hasText: 'Oracle' }).textContent().catch(() => '');
if (!/You asked for symmetry/.test(heard ?? '')) await fail(`the oracle did not hear the human: ${heard}`);
await page.click('button.os-veto');
await page.waitForSelector('.os-amendment.is-vetoed', { timeout: 8000 }).catch(() => fail('the veto was not recorded'));

await page.click('.os-dock-btn:has-text("Gallery")');
await page.waitForSelector('.os-gallery', { timeout: 4000 });
const storage = await page.locator('.os-gallery .os-hint').first().textContent();
if (!/Storage: (sqlite on OPFS|memory)\./.test(storage ?? '')) await fail(`unexpected storage: ${storage}`);
await page.fill('#os-title-input', 'e2e');
await page.click('button:has-text("Keep")');
await page.waitForSelector('.os-artwork-title:has-text("e2e")', { timeout: 8000 }).catch(() => fail('the artwork was not kept'));

console.log(`os e2e: OK (${storage?.trim()})`);
await browser.close();
