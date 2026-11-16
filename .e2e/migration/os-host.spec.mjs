/**
 * A host application that is itself the desktop, in a real browser: on a
 * phone the desktop is compact and the dock stays on screen with every screen
 * reachable by pointer and keyboard; the host decides the dock's tray and may
 * add a brand mark; the host and its screens hear what happens to windows;
 * host glyphs render wherever a module's icon does; a minified stylesheet keeps
 * the windows' glass; a window is a region and opens with its animation once.
 */
import { test, expect } from './playwright.mjs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let server, origin, minified;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tangle-os-host-'));
  const bun = process.env.BUN ?? 'bun';
  execFileSync(bun, ['build', join(repo, 'test/fixtures/os-host/main.ts'), '--target=browser', '--format=esm', `--outfile=${join(out, 'main.js')}`], { stdio: 'inherit' });
  execFileSync(bun, ['build', join(repo, 'test/fixtures/os-host/echo.ts'), '--target=browser', '--format=esm', `--outfile=${join(out, 'echo.js')}`], { stdio: 'inherit' });
  for (const page of ['index.html', 'echo.html', 'silent.html']) copyFileSync(join(repo, 'test/fixtures/os-host', page), join(out, page));
  // the host ships the stylesheet the way a production build does: minified
  execFileSync(bun, ['build', join(repo, 'components/os/styles/os.css'), '--minify', `--outfile=${join(out, 'os.css')}`], { stdio: 'inherit' });
  minified = readFileSync(join(out, 'os.css'), 'utf8');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname.replace(/^\/$/, '/index.html');
    let body;
    try { body = readFileSync(join(out, path)); } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }); response.end(body);
  });
  // the desktop is 127.0.0.1; framed applications come from localhost, a second origin on the same server
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => server?.close());

async function host(page, query, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/?${query}`);
  await page.waitForFunction(() => window.harness);
}
const dockBox = (page) => page.locator('.tos-dock').evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: innerWidth }; });

for (const viewport of [{ width: 390, height: 844 }, { width: 760, height: 640 }]) {
  test(`at ${viewport.width}×${viewport.height} the dock stays on screen and every screen opens from it by pointer and keyboard`, async ({ page }) => {
    await host(page, 'modules=16&compact=760', viewport);
    const box = await dockBox(page);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.width);
    const tiles = page.locator('.tos-dock-item[data-module]');
    await expect(tiles).toHaveCount(16);
    // the last screen by pointer, the first by keyboard
    await tiles.last().scrollIntoViewIfNeeded();
    await tiles.last().click();
    await expect(page.locator('.tos-window[data-module="screen-16"]')).toBeVisible();
    await tiles.first().focus();
    await page.keyboard.press('Enter');
    const first = page.locator('.tos-window[data-module="screen-1"]');
    await expect(first).toBeVisible();
    for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
    await expect(page.locator('.tos-dock-item[data-module="screen-16"]')).toBeFocused();
    const compact = viewport.width < 760;
    // measured at rest: the opening animation overshoots by design
    await expect(first).not.toHaveClass(/is-opening/);
    const rect = await first.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; });
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(viewport.width);
    if (compact) {
      // compact: maximized above the dock, and only the focused window shown
      await expect(first).toHaveClass(/is-maximized/);
      await expect(page.locator('.tos-window:visible')).toHaveCount(1);
      await expect(first.locator('.tos-maximize')).toBeHidden();
    } else {
      await expect(page.locator('.tos-window:visible')).toHaveCount(2);
    }
  });
}

test('the host decides the tray: no mail tile, a brand mark first that takes no keyboard stop', async ({ page }) => {
  await host(page, 'modules=3&mail=0&brand=1', { width: 1280, height: 800 });
  await expect(page.locator('.tos-dock-mail')).toHaveCount(0);
  await expect(page.locator('.tos-dock-theme')).toHaveCount(1);
  const children = await page.locator('.tos-dock > *').evaluateAll(els => els.map(el => el.className));
  expect(children[0]).toBe('tos-dock-brand');
  await expect(page.getByRole('img', { name: 'Example shop' })).toBeVisible();
  const sent = await page.evaluate(() => { window.harness.kernel.sendMail('screen-1', { subject: 'Answer arrived' }); return window.harness.kernel.mail().map(m => m.subject); });
  expect(sent).toEqual(['Answer arrived']);
  await page.locator('.tos-dock-item').first().focus();
  expect(await page.evaluate(() => document.activeElement?.dataset.module)).toBe('screen-1');
  await page.locator('.tos').click({ button: 'right', position: { x: 600, y: 200 } });
  await expect(page.getByRole('menuitem', { name: 'Mail' })).toHaveCount(0);
});

test('the host rebuilds the desktop from its events, and a screen hears when its window is hidden', async ({ page }) => {
  await host(page, 'modules=3', { width: 1280, height: 800 });
  await page.evaluate(() => {
    const { desktop } = window.harness;
    const a = desktop.open('screen-1'), b = desktop.open('screen-2');
    desktop.move(b, 120, 90);
    desktop.minimize(a);
    desktop.focus(a);
    desktop.maximize(b); desktop.maximize(b);
    desktop.close(b);
    desktop.open('screen-3');
  });
  const { rebuilt, state, types, visibility } = await page.evaluate(() => {
    const { desktop, events, visibility } = window.harness;
    const windows = new Map(); let focus = null;
    for (const e of events) {
      if (e.type === 'closed') windows.delete(e.window); else windows.set(e.window, e.state);
      if (e.type === 'focused') focus = e.window;
      if (e.type === 'closed' && focus === e.window) focus = null;
    }
    const s = desktop.state();
    if (s.focus && !windows.has(s.focus)) focus = null;
    return { rebuilt: { windows: [...windows.values()].sort((x, y) => x.id.localeCompare(y.id)), focus: s.focus ? focus ?? s.focus : null }, state: { windows: s.windows.sort((x, y) => x.id.localeCompare(y.id)), focus: s.focus }, types: [...new Set(events.map(e => e.type))].sort(), visibility };
  });
  expect(rebuilt.windows).toEqual(state.windows);
  expect(types).toEqual(['closed', 'focused', 'maximized', 'minimized', 'moved', 'opened', 'ready', 'restored']);
  expect(visibility.w1).toEqual([true, false, true], 'the first screen was told it was hidden and shown again');
});

test('a host glyph renders in the dock, a title bar and a menu', async ({ page }) => {
  await host(page, 'modules=2', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.open('screen-1'));
  const masks = async (selector) => page.locator(selector).first().evaluate(el => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage);
  expect(await masks('.tos-dock-item[data-module="screen-1"] .tos-glyph')).toContain('data:image/svg+xml');
  expect(await masks('.tos-window[data-module="screen-1"] .tos-titlebar .tos-glyph')).toContain('data:image/svg+xml');
  await page.locator('.tos').click({ button: 'right', position: { x: 40, y: 40 } });
  expect(await masks('.tos-menu .tos-glyph[data-glyph="tag"]')).toContain('data:image/svg+xml');
});

test('a minified stylesheet keeps the glass, and a window is a region that opens with its animation once', async ({ page }) => {
  expect(minified.match(/(?<!-webkit-)backdrop-filter:var\(--os-glass\)/g)?.length).toBe(4);
  await host(page, 'modules=2', { width: 1280, height: 800 });
  const id = await page.evaluate(() => window.harness.desktop.open('screen-1'));
  const win = page.locator(`.tos-window[data-window="${id}"]`);
  await expect(win).toHaveAttribute('role', 'region');
  await expect(win).not.toHaveClass(/is-opening/);
  expect(await win.evaluate(el => getComputedStyle(el).backdropFilter)).not.toBe('none');
  await page.evaluate((w) => { window.harness.desktop.maximize(w); window.harness.desktop.maximize(w); window.harness.desktop.minimize(w); window.harness.desktop.focus(w); }, id);
  expect(await win.evaluate(el => [el.classList.contains('is-opening'), el.getAnimations().length])).toEqual([false, 0]);
});

test('a framed application that never answers is reported, holds nothing open, and can be tried again', async ({ page }) => {
  await host(page, 'modules=1&framed=1&deadline=600', { width: 1280, height: 800 });
  const id = await page.evaluate(() => window.harness.desktop.open('silent'));
  const win = page.locator(`.tos-window[data-window="${id}"]`);
  await expect(win.getByRole('alert')).toContainText('Silent did not answer');
  expect(await page.evaluate(() => window.harness.events.filter(e => e.module === 'silent').map(e => e.type))).toContain('failed');
  await win.getByRole('button', { name: 'Try again' }).click();
  await expect(win.getByRole('alert')).toHaveCount(0);
  await expect(win.getByRole('alert')).toContainText('Silent did not answer');
  expect(await page.evaluate(() => window.harness.events.filter(e => e.module === 'silent' && e.type === 'failed').length)).toBe(2);
});

test('a framed application that reloads connects again on fresh ports', async ({ page }) => {
  await host(page, 'modules=1&framed=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  const say = () => page.evaluate(async () => {
    for (let i = 0; i < 80; i++) {
      const r = await window.harness.kernel.call('shell', 'echo', 'echo.say', { text: 'hi' });
      if (r.ok) return r.value;
      await new Promise(res => setTimeout(res, 100));
    }
    return null;
  });
  expect(await say()).toEqual({ text: 'hi', loaded: 1 });
  await page.locator('.tos-window[data-module="echo-app"] iframe').evaluate(frame => { frame.src = frame.src; });
  await expect.poll(async () => page.evaluate(() => window.harness.events.filter(e => e.module === 'echo-app' && e.type === 'ready').length)).toBe(2);
  expect(await say()).toEqual({ text: 'hi', loaded: 2 });
});
