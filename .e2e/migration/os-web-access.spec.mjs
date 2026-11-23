/**
 * Web access on the Pages desktop, in a real browser: Settings names a reader
 * on another origin (as the desktop app on this machine would be), refuses an
 * address that is not one, tests it across origins, and the Web app reads a
 * page through it; removing it brings back the "no web access" message.
 */
import { test, expect } from './playwright.mjs';
import { createServer } from 'node:http';
import { compileContract } from '@jarenjs/contract';
import { serveHttp } from '@jarenjs/contract/http';
import { toNodeHandler } from '@jarenjs/contract/node';
import { WEB_READER_CONTRACT } from '../../components/os/src/web.ts';

let server, base = '';
test.beforeAll(async () => {
  const dispatcher = serveHttp(compileContract(WEB_READER_CONTRACT), {
    'web.read': async ({ url }) => ({ url, finalUrl: url, title: 'A reader page', blocks: [{ kind: 'heading', level: 1, text: 'A reader page' }, { kind: 'paragraph', text: 'Read across origins.' }], links: [], fetchedAt: '2026-11-23T00:00:00.000Z', redirects: [] }),
    'web.search': async () => ({ results: [{ title: 'A reader page', url: 'https://example.org/page' }] }),
  }, { validateOutput: 'always' });
  const handle = toNodeHandler(dispatcher);
  // the reader admits the desktop's origin, as the desktop app's route does
  server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', request.headers.origin ?? '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-private-network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    handle(request, response);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

test('Settings names a reader on another origin, tests it, and the Web app reads through it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs?.kernel);
  await page.evaluate(() => window.tangleOs.desktop.openSettings());
  await page.locator('.tos-settings-nav [data-section="web"]').click();
  const field = page.locator('#tos-web-reader');
  const status = page.locator('.tos-settings-status[role="status"]');
  await expect(status).toContainText('No reader is set');
  await field.fill('ftp://nowhere.example');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status).toContainText('Enter an http or https address');
  await field.fill(base);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(status).toHaveText('The reader address is saved.');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(status).toHaveText('The reader answers.');

  // the Web app reads a page through that reader
  await page.evaluate(() => window.tangleOs.desktop.open('web'));
  const web = page.locator('.tos-window[data-module="web"]');
  const address = web.getByRole('textbox').first();
  await address.fill('https://example.org/page');
  await address.press('Enter');
  await expect(web.locator('article')).toContainText('Read across origins.');

  // removed: the Web app says no web access is configured
  await page.evaluate(() => window.tangleOs.desktop.openSettings());
  await page.locator('.tos-settings-nav [data-section="web"]').click();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(status).toContainText('The reader address is removed.');
  await page.evaluate(() => window.tangleOs.desktop.focus(window.tangleOs.desktop.state().windows.find(w => w.module === 'web').id));
  await address.fill('https://example.org/page');
  await address.press('Enter');
  await expect(web.locator('[data-code="OS0180"]')).toBeVisible();
});
