/**
 * Background work that needs a person reaches them: the desktop's job watcher
 * files a dead job and a single-send job a crash cut off into the inbox, one
 * item each, with the dock's mail button ringed while they ask for attention;
 * Run again requeues the job once, Dismiss calls nothing. Each item speaks the
 * person's language. Built on the os-host fixture (`?jobs=1&watch=1`: its
 * queue has two dead mail jobs, one of them cut off and not repeated).
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
  const out = mkdtempSync(join(tmpdir(), 'tangle-os-jobs-'));
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

async function openInbox(page, query) {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${origin}/?modules=1&jobs=1&watch=1${query}`);
  await page.waitForFunction(() => window.harness);
  await expect(page.locator('.tos-dock-mail.has-attention')).toBeVisible();
  await page.locator('.tos-dock-mail').click();
  return page.locator('.tos-mail');
}

test('a dead job and a job a crash cut off reach the inbox once each; Run again requeues once, Dismiss calls nothing', async ({ page }) => {
  const mail = await openInbox(page, '');
  await expect(page.locator('.tos-dock-mail')).toHaveAttribute('aria-label', /needs your attention/);
  const dead = mail.locator('.tos-proposal[data-proposal="job-failed-mail-0001"]');
  const cut = mail.locator('.tos-proposal[data-proposal="job-failed-mail-0002"]');
  await expect(dead).toContainText('mail.send stopped after 5 attempts');
  await expect(dead).toContainText('Last error, as the other system wrote it: the courier refused the parcel');
  await expect(cut).toContainText('mail.send was cut off and is not repeated');
  await expect(cut).toContainText('It may already have been sent.');
  await expect(mail.locator('.tos-proposal[data-proposal^="job-failed-"]')).toHaveCount(2);
  await page.waitForTimeout(2_500);   // another look of the watcher: still one item each
  await expect(mail.locator('.tos-proposal[data-proposal^="job-failed-"]')).toHaveCount(2);

  await dead.getByRole('button', { name: 'Run again' }).click();
  await expect.poll(async () => (await page.evaluate(() => window.harness.jobCalls)).filter(c => c.requeue === 'mail-0001').length).toBe(1);
  await cut.getByRole('button', { name: 'Dismiss' }).click();
  await page.waitForTimeout(500);
  const calls = await page.evaluate(() => window.harness.jobCalls);
  expect(calls.filter(c => c.requeue === 'mail-0002')).toEqual([]);
  expect(calls.filter(c => c.requeue).length).toBe(1);
});

test('the items speak the person\'s language', async ({ page }) => {
  const mail = await openInbox(page, '&lang=nl');
  const dead = mail.locator('.tos-proposal[data-proposal="job-failed-mail-0001"]');
  await expect(dead).toContainText('mail.send is gestopt na 5 pogingen');
  await expect(dead.getByRole('button', { name: 'Opnieuw uitvoeren' })).toBeVisible();
  await expect(dead.getByRole('button', { name: 'Negeren' })).toBeVisible();
  await expect(dead.getByRole('button', { name: 'Taken openen' })).toBeVisible();
});

test('a host running two products: a dead job of the second reaches the inbox named by its product, and Run again goes to that product', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${origin}/?modules=1&jobs=2&watch=1`);
  await page.waitForFunction(() => window.harness);
  await expect(page.locator('.tos-dock-mail.has-attention')).toBeVisible();
  await page.locator('.tos-dock-mail').click();
  const mail = page.locator('.tos-mail');
  const printing = mail.locator('.tos-proposal[data-proposal="job-failed-printing-print-0001"]');
  await expect(printing).toContainText('From the background work of Printing');
  await expect(mail.locator('.tos-proposal[data-proposal="job-failed-orders-mail-0001"]')).toContainText('From the background work of Orders');
  await printing.getByRole('button', { name: 'Run again' }).click();
  await expect.poll(async () => (await page.evaluate(() => window.harness.jobCalls)).filter(c => c.scope === 'printing' && c.requeue === 'print-0001').length).toBe(1);
  expect((await page.evaluate(() => window.harness.jobCalls)).filter(c => c.requeue && c.scope !== 'printing')).toEqual([]);
});

test('Jobs shows one product at a time: the products row and the header menu switch it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${origin}/?modules=1&jobs=2&lang=nl`);
  await page.waitForFunction(() => window.harness);
  await page.evaluate(() => window.harness.desktop.open('jobs'));
  const win = page.locator('.tos-window[data-module="jobs"]');
  const row = win.locator('.tos-jobs-products');
  await expect(row.locator('.tos-jobs-product')).toHaveCount(2);
  await expect(row.locator('.tos-jobs-product').nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.tos-jobs-product').nth(1)).toContainText('Afdrukken: 1 mislukt, 1 wachtend');
  await expect(win.locator('.tos-titlebar')).toContainText('Productkeuze: Bestellingen');
  await row.locator('.tos-jobs-product').nth(1).click();
  await expect(win.locator('.tos-titlebar')).toContainText('Productkeuze: Afdrukken');
  await expect(row.locator('.tos-jobs-product').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await page.evaluate(() => window.harness.jobCalls)).some(c => c.scope === 'printing' && c.counts)).toBe(true);
  await page.screenshot({ path: process.env.PICKER_SHOT ?? join(tmpdir(), 'jobs-picker.png') });
});
