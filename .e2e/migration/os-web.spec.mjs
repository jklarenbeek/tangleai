/**
 * The desktop's Web reads pages through its host's reader and draws them in
 * the desktop's look, never a frame: a search lists results, a result opens,
 * a link on a page reads in the reader, back and forward walk what was read,
 * "Open original" is a new-tab link to the address the redirects ended at,
 * a page's script stays text, and a desktop with no web access says so and
 * offers Settings. Built on the os-host fixture (`?web=1`, `?web=none`).
 */
import { test, expect } from './playwright.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let server, origin;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tangle-os-web-'));
  const bun = process.env.BUN ?? 'bun';
  execFileSync(bun, ['build', join(repo, 'test/fixtures/os-host/main.ts'), '--target=browser', '--format=esm', `--outfile=${join(out, 'main.js')}`], { stdio: 'inherit' });
  execFileSync(bun, ['build', join(repo, 'components/os/styles/os.css'), '--minify', `--outfile=${join(out, 'os.css')}`], { stdio: 'inherit' });
  copyFileSync(join(repo, 'test/fixtures/os-host/index.html'), join(out, 'index.html'));
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
    let body;
    try { body = readFileSync(join(out, path)); } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

async function openWeb(page, query) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/?modules=1&${query}`);
  await page.waitForFunction(() => window.harness);
  await page.evaluate(() => window.harness.desktop.open('web'));
  const win = page.locator('.tos-window[data-module="web"]');
  await expect(win.locator('.tos-web-status')).toHaveText('Type an address, or the words you are looking for.');
  return win;
}

test('Web searches, opens a result, follows a link on the page, and walks back and forward', async ({ page }) => {
  const popups = [];
  page.on('popup', (popup) => popups.push(popup));
  const win = await openWeb(page, 'web=1');
  const bar = win.locator('.tos-titlebar');
  const address = win.getByRole('textbox', { name: 'Address or search' });
  await expect(bar.getByRole('button', { name: 'Back' })).toBeDisabled();

  // words search, by Enter
  await address.fill('alpha beta');
  await address.press('Enter');
  const results = win.getByRole('list', { name: 'Search results' });
  await expect(win.locator('.tos-web-status')).toHaveText('2 results for alpha beta');
  await expect(results.locator('.tos-web-result')).toHaveCount(2);
  await expect(results.locator('.tos-web-result').first()).toContainText('Alpha links to the beta page.');

  // a result opens in the reader: the page drawn in the desktop's look, never a frame
  await results.getByRole('link', { name: 'Alpha page' }).click();
  const article = win.locator('article.tos-web-page');
  await expect(article.locator('h1')).toHaveText('Alpha page');
  await expect(article).toHaveAttribute('lang', 'en');
  await expect(article.locator('h3')).toHaveText('About alpha');
  await expect(article.locator('pre code')).toHaveText('const answer = 42;');
  await expect(address).toHaveValue('https://pages.example/alpha');
  expect(await win.locator('iframe').count()).toBe(0);
  // a page's markup stays text, and a javascript: link is not followed
  await expect(article).toContainText('<script>alert(1)</script>');
  expect(await article.locator('script').count()).toBe(0);
  await expect(article.locator('a[aria-disabled="true"]')).toHaveText('a script');
  await expect(article.locator('a[aria-disabled="true"]')).not.toHaveAttribute('href', /./);

  // a link on the page reads in the reader; the redirect's end is what is shown and opened
  await article.getByRole('link', { name: 'the beta page' }).click();
  await expect(article.locator('h1')).toHaveText('Beta-Seite');
  await expect(article).toHaveAttribute('lang', 'de');
  await expect(article.locator('table td').first()).toHaveText('Name');
  const original = win.getByRole('link', { name: 'Open original' });
  await expect(original).toHaveAttribute('href', 'https://pages.example/beta');
  await expect(original).toHaveAttribute('target', '_blank');
  await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(win.locator('.tos-web-where')).toHaveText('https://pages.example/beta');

  // back to alpha, back to the results, forward to alpha again
  await bar.getByRole('button', { name: 'Back' }).click();
  await expect(article.locator('h1')).toHaveText('Alpha page');
  await bar.getByRole('button', { name: 'Back' }).click();
  await expect(results.locator('.tos-web-result')).toHaveCount(2);
  await expect(address).toHaveValue('alpha beta');
  await expect(bar.getByRole('button', { name: 'Back' })).toBeDisabled();
  await bar.getByRole('button', { name: 'Forward' }).click();
  await expect(article.locator('h1')).toHaveText('Alpha page');

  // a link the reader follows never navigated the desktop or opened a tab
  expect(new URL(page.url()).origin).toBe(origin);
  expect(popups).toEqual([]);
  expect(await page.evaluate(() => window.harness.webCalls)).toEqual([
    { search: 'alpha beta' }, { read: 'https://pages.example/alpha' }, { read: 'https://pages.example/beta' },
    { read: 'https://pages.example/alpha' }, { search: 'alpha beta' }, { read: 'https://pages.example/alpha' },
  ]);
});

test('Web takes a bare host as an address, and says why a page is refused or unreadable', async ({ page }) => {
  const win = await openWeb(page, 'web=1');
  const address = win.getByRole('textbox', { name: 'Address or search' });
  const status = win.locator('.tos-web-status');
  await address.fill('pages.example/alpha');
  await win.getByRole('button', { name: 'Go' }).click();
  await expect(win.locator('article.tos-web-page h1')).toHaveText('Alpha page');

  await address.fill('https://private.example/');
  await address.press('Enter');
  await expect(status).toHaveAttribute('data-code', 'OS0181');
  await expect(status).toHaveText('This address is refused: https://private.example/. a private host');
  await expect(win.locator('article')).toHaveCount(0);

  await address.fill('https://pages.example/gone');
  await address.press('Enter');
  await expect(status).toHaveAttribute('data-code', 'OS0182');
  await expect(status).toHaveText('This page could not be read: https://pages.example/gone. HTTP 404');

  await address.fill('nothing');
  await address.press('Enter');
  await expect(status).toHaveText('No results for nothing.');
  await expect(status).not.toHaveAttribute('data-code', /./);
});

test('Web without web access says so (OS0180) and offers Settings', async ({ page }) => {
  const win = await openWeb(page, 'web=none&settings=1');
  const address = win.getByRole('textbox', { name: 'Address or search' });
  await address.fill('https://pages.example/alpha');
  await address.press('Enter');
  const status = win.locator('.tos-web-status');
  await expect(status).toHaveAttribute('data-code', 'OS0180');
  await expect(status).toHaveText('No web access is configured on this desktop.');
  await expect(win.locator('.tos-web-empty')).toContainText('Name one in Settings');
  await win.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.locator('.tos-window[data-module="settings"]')).toBeVisible();
});

test('Web reads right to left in Arabic, the page keeping its own direction', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/?modules=1&web=1&lang=ar`);
  await page.waitForFunction(() => window.harness);
  await page.evaluate(() => window.harness.desktop.open('web'));
  const win = page.locator('.tos-window[data-module="web"]');
  const address = win.locator('.tos-web-address');
  await address.fill('https://pages.example/alpha');
  await address.press('Enter');
  const article = win.locator('article.tos-web-page');
  await expect(article.locator('h1')).toHaveText('Alpha page');
  await expect(article).toHaveAttribute('dir', 'auto');
  await expect(win.locator('.tos-web-where')).toHaveAttribute('dir', 'ltr');
  // the bar follows the desktop: the address field starts on the right
  const [field, go] = await Promise.all([address.boundingBox(), win.locator('.tos-web-go').boundingBox()]);
  expect(field.x).toBeGreaterThan(go.x);
});
