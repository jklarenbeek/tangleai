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
import { serveDesktopState, memoryStateRepository } from '../../components/os/src/state-server.ts';

const repo = fileURLToPath(new URL('../..', import.meta.url));
let server, origin, minified;
// the desktop state as an application's server keeps it: one repository for every browser that signs in as Ann
const repository = memoryStateRepository();
const stateHandlers = serveDesktopState(repository, () => ({ person: 'ann', application: 'acme' }));
let stateDown = false;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), 'tangle-os-host-'));
  const bun = process.env.BUN ?? 'bun';
  execFileSync(bun, ['build', join(repo, 'test/fixtures/os-host/main.ts'), '--target=browser', '--format=esm', `--outfile=${join(out, 'main.js')}`], { stdio: 'inherit' });
  execFileSync(bun, ['build', join(repo, 'test/fixtures/os-host/echo.ts'), '--target=browser', '--format=esm', `--outfile=${join(out, 'echo.js')}`], { stdio: 'inherit' });
  for (const page of ['index.html', 'echo.html', 'silent.html', 'old.html']) copyFileSync(join(repo, 'test/fixtures/os-host', page), join(out, page));
  // the image Echo's file location signs an address for
  writeFileSync(join(out, 'logo.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGPg7Wr+TwlmGDVg1IBRA4aLAQCkXxkf42zACAAAAABJRU5ErkJggg==', 'base64'));
  // an application on an earlier release joins with that release's one-file module side, from git
  writeFileSync(join(out, 'old-module.js'), execFileSync('git', ['show', 'v0.49.2:releases/os/tangle-os-module.js'], { cwd: repo, maxBuffer: 8 << 20 }));
  // the host ships the stylesheet the way a production build does: minified
  execFileSync(bun, ['build', join(repo, 'components/os/styles/os.css'), '--minify', `--outfile=${join(out, 'os.css')}`], { stdio: 'inherit' });
  minified = readFileSync(join(out, 'os.css'), 'utf8');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  server = createServer((request, response) => {
    const route = new URL(request.url, 'http://x').pathname;
    if (route.startsWith('/state/')) {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', async () => {
        if (stateDown) { response.writeHead(503); response.end(); return; }
        const answer = await stateHandlers[route.slice('/state/'.length)]?.(JSON.parse(body || '{}'));
        response.writeHead(answer ? 200 : 404, { 'content-type': 'application/json' }); response.end(JSON.stringify(answer ?? {}));
      });
      return;
    }
    const path = route.replace(/^\/$/, '/index.html');
    let body;
    try { body = readFileSync(join(out, path)); } catch { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', ...(path === '/logo.png' ? { 'access-control-allow-origin': '*' } : {}) }); response.end(body);
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
  // windows, the dock, the mail, menus and the dock's folder panel
  expect(minified.match(/(?<!-webkit-)backdrop-filter:var\(--os-glass\)/g)?.length).toBe(5);
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

const settingsWindow = (page) => page.locator('.tos-window[data-module="settings"]');

test("every application's settings are found in one place: from Settings, the window menu and the application itself", async ({ page }) => {
  await host(page, 'modules=2&framed=1&settings=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.openSettings());
  const settings = settingsWindow(page);
  const nav = settings.locator('.tos-settings-nav');
  await expect(nav.locator('button')).toHaveText(['General', 'Screen 1', 'Echo', 'Notes']);
  await expect(nav.locator('.tos-settings-group')).toHaveText('Applications');
  await settings.getByRole('searchbox', { name: 'Search settings' }).fill('labels');
  await expect(nav.locator('button')).toHaveText(['Screen 1']);
  await settings.getByRole('searchbox', { name: 'Search settings' }).fill('');
  // the window menu offers Settings for an application that declares them
  await page.evaluate(() => { window.harness.desktop.close(window.harness.desktop.state().windows.find(w => w.module === 'settings').id); window.harness.desktop.open('screen-1'); });
  await page.locator('.tos-window[data-module="screen-1"] .tos-titlebar').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(settings.locator('.tos-settings-pane h2.screen-settings')).toHaveText('Screen 1 settings');
  await expect(settings.locator('[data-section="module:screen-1"]')).toHaveAttribute('aria-current', 'page');
  // and the application opens its own section itself, with no grant
  await settings.locator('[data-section="general"]').click();
  await page.evaluate(() => window.harness.contexts['screen-1'].openSettings());
  await expect(settings.locator('[data-section="module:screen-1"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.tos-window[data-module="settings"]')).toHaveCount(1, 'one Settings window, not one per application');
});

test("an application's settings page joins from its own origin without taking the application's contract", async ({ page }) => {
  await host(page, 'modules=1&framed=1&settings=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.openSettings('echo-app'));
  const frame = settingsWindow(page).frameLocator('iframe.tos-settings-frame');
  await expect(frame.locator('body')).toHaveAttribute('data-joined', 'yes');
  const outcome = await page.evaluate(() => window.harness.kernel.call('shell', 'echo', 'echo.say', { text: 'hi' }));
  expect(outcome.ok).toBe(false);
  expect(outcome.error.code).toBe('OS0102');
});

test("a document module's settings are a form whose values the desktop keeps, checked against its schema", async ({ page }) => {
  await host(page, 'modules=1&settings=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.openSettings('notes-doc'));
  const settings = settingsWindow(page);
  await settings.getByLabel('Greeting').fill('Good morning');
  await expect.poll(() => page.evaluate(() => window.harness.kernel.settings('notes-doc'))).toEqual({ greeting: 'Good morning' });
  await expect(settings.locator('.tos-settings-status')).toHaveText('Saved.');
  await settings.getByLabel('Count').fill('99');
  await expect(settings.locator('.tos-settings-status')).toContainText('Not saved');
  expect(await page.evaluate(() => window.harness.kernel.settings('notes-doc'))).toEqual({ greeting: 'Good morning' });
});

test('an application built on the 0.49.2 release still joins this desktop and serves its contract', async ({ page }) => {
  await host(page, 'modules=1&framed=1&settings=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.open('old-echo'));
  await expect.poll(() => page.evaluate(async () => (await window.harness.kernel.call('shell', 'echo_old', 'echo.say', { text: 'hi' })).value ?? null)).toEqual({ text: 'hi', from: '0.49.2' });
  expect(await page.evaluate(() => window.harness.events.filter(e => e.module === 'old-echo').map(e => e.type))).toContain('ready');
});

test('the person decides an application\'s proposals in the mail; the decision goes back to it, refusals and closed applications stay pending', async ({ page }) => {
  await host(page, 'modules=1&framed=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  await expect.poll(() => page.evaluate(() => window.harness.kernel.mail().filter(m => m.proposal).length)).toBe(2);
  await expect(page.locator('.tos-dock-mail .tos-badge')).toHaveText('2');
  await page.locator('.tos-dock-mail').click();
  const panel = page.locator('.tos-mail');
  await expect(panel.locator('.tos-mail-group')).toHaveText('To decide');
  const first = panel.locator('[data-proposal="echo-1"]');
  await expect(first).toContainText('Send the echo');
  await expect(first.getByRole('link', { name: 'The call' })).toHaveAttribute('href', 'https://example.com/call');
  await first.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => page.evaluate(() => window.harness.kernel.mail().find(m => m.proposal?.id === 'echo-1').proposal.status)).toBe('accepted');
  await expect(page.locator('.tos-window[data-module="echo-app"] iframe').contentFrame().locator('body')).toHaveAttribute('data-decided', 'echo-1:accept');
  const second = panel.locator('[data-proposal="echo-2"]');
  await second.getByRole('button', { name: 'Accept' }).click();
  await expect(second.getByRole('alert')).toHaveText('Not done: the echo moved');
  await expect(page.locator('.tos-dock-mail .tos-badge')).toHaveText('1');
  await page.evaluate(() => window.harness.desktop.close(window.harness.desktop.state().windows.find(w => w.module === 'echo-app').id));
  await panel.locator('[data-proposal="echo-2"]').getByRole('button', { name: 'Reject' }).click();
  await expect(panel.locator('[data-proposal="echo-2"]').getByRole('alert')).toHaveText('Echo is not running. Open it, then decide again.');
  expect(await page.evaluate(() => window.harness.kernel.mail().find(m => m.proposal?.id === 'echo-2').proposal.status)).toBe('pending');
});

// ── header bars ───────────────────────────────────────────────────────────
const echoWindow = (page) => page.locator('.tos-window[data-module="echo-app"]');
const echoFrame = (page) => page.frameLocator('.tos-window[data-module="echo-app"] iframe');
const used = async (page) => JSON.parse(await echoFrame(page).locator('body').getAttribute('data-used') ?? '[]');
async function openEcho(page, query, viewport) {
  await host(page, `modules=2&framed=1&header=1${query}`, viewport);
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  await expect(echoWindow(page).locator('.tos-titlebar').getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true');
  return echoWindow(page).locator('.tos-titlebar');
}

test("a framed application's header bar is drawn by the desktop and used by the person and the assistant down one path", async ({ page }) => {
  const bar = await openEcho(page, '', { width: 1280, height: 800 });
  // tabs by pointer and keyboard; the application sets the header again and the desktop keeps up
  await bar.getByRole('tab', { name: 'Replies' }).click();
  await expect(bar.getByRole('tab', { name: 'Replies' })).toHaveAttribute('aria-selected', 'true');
  await bar.getByRole('tab', { name: 'Replies' }).press('ArrowRight');
  await expect(bar.getByRole('tab', { name: 'Archive' })).toHaveAttribute('aria-selected', 'true');
  await expect(bar.getByRole('tab', { name: 'Archive' })).toBeFocused();
  await bar.getByRole('button', { name: 'Pin' }).click();
  await expect(bar.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true');
  // typing in the search: no drag, no maximize, and the text reaches the application
  const before = await page.evaluate(() => window.harness.desktop.state().windows.find(w => w.module === 'echo-app').rect);
  const search = bar.getByRole('searchbox', { name: 'Search echoes' });
  await search.dblclick();
  await search.fill('hello');
  await expect(echoFrame(page).locator('body')).toHaveAttribute('data-found', 'hello');
  // a search that shrank to its icon opens across the bar while it has focus, and closes when the person moves on
  await search.blur();
  const after = await page.evaluate(() => window.harness.desktop.state().windows.find(w => w.module === 'echo-app'));
  expect([after.rect, after.maximized]).toEqual([before, false]);
  // a menu with a shortcut hint
  await bar.getByRole('button', { name: 'Echo menu' }).click();
  await expect(page.getByRole('menuitem', { name: /Export/ })).toContainText('Ctrl+E');
  await page.getByRole('menuitem', { name: /Export/ }).click();
  await expect(bar.getByRole('button', { name: 'Echo menu' })).toHaveAttribute('aria-expanded', 'false');
  // each use crosses into the framed page over its port: wait for the last one to land
  await expect.poll(async () => (await used(page)).length).toBe(5);
  expect((await used(page)).map(u => [u.item, u.value, u.by])).toEqual([
    ['view', 'replies', 'person'], ['view', 'archive', 'person'], ['pin', true, 'person'], ['find', 'hello', 'person'], ['more', 'export', 'person'],
  ]);

  // the assistant reads the same bar, without what the application kept from it, and uses it the same way
  const id = await page.evaluate(() => window.harness.desktop.state().windows.find(w => w.module === 'echo-app').id);
  const listed = await page.evaluate(() => window.harness.kernel.call('assistant', 'tangle_os_header', 'header.list', {}));
  expect(listed.value.windows.map(w => w.window)).toEqual([id]);
  expect(JSON.stringify(listed.value)).not.toContain('clear');
  expect((await page.evaluate((target) => window.harness.kernel.call('assistant', 'tangle_os_header', 'header.activate', { window: target, item: 'view', value: 'calls' }), id)).ok).toBe(true);
  await expect(bar.getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true');
  await expect(bar.locator('.tos-hb-tabs')).toHaveClass(/is-used/);
  await expect.poll(async () => (await used(page)).length).toBe(6);
  const kept = await page.evaluate((target) => window.harness.kernel.call('assistant', 'tangle_os_header', 'header.activate', { window: target, item: 'more', value: 'clear' }), id);
  expect(kept.error.code).toBe('OS0115');
  expect((await used(page)).at(-1)).toEqual({ item: 'view', value: 'calls', by: 'assistant' });
  // every use, the person's included, is in the ledger
  const ledger = await page.evaluate(() => window.harness.kernel.ledger().filter(l => l.contract === 'tangle_os_header').map(l => l.caller));
  expect(ledger.filter(c => c === 'shell').length).toBe(5);

  // a reload draws no stale bar: the reloaded application starts over on its own state
  await bar.getByRole('tab', { name: 'Replies' }).click();
  await expect(bar.getByRole('tab', { name: 'Replies' })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate((target) => { document.querySelector(`.tos-window[data-window="${target}"] iframe`).src += ''; }, id);
  await expect(bar.getByRole('tab', { name: 'Calls' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: test.info().outputPath('header-wide.png') });
});

test('a narrow window keeps what fits and moves the rest into "more", mirrored right to left', async ({ page }) => {
  const bar = await openEcho(page, '&compact=760&dir=rtl', { width: 390, height: 844 });
  const more = bar.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  // the tabs keep their room; the search shrinks to its icon and opens across the bar while it has focus
  await expect(bar.getByRole('tab', { name: 'Calls' })).toBeVisible();
  const search = bar.getByRole('searchbox', { name: 'Search echoes' });
  await expect(search).toHaveClass(/is-collapsed/);
  await search.focus();
  expect(await search.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(300);
  await search.blur();
  await more.click();
  const moved = await page.getByRole('menu').getByRole('menuitem').allTextContents();
  expect(moved.length).toBeGreaterThan(0);
  await page.getByRole('menu').getByRole('menuitem').first().click();
  await expect.poll(async () => (await used(page)).length).toBe(1);
  // right to left, the arrow keys follow the reading direction
  await bar.getByRole('tab', { name: 'Calls' }).press('ArrowLeft');
  await expect(bar.getByRole('tab', { name: 'Replies' })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: test.info().outputPath('header-narrow-rtl.png') });
});

// ── the dock: launch entries, folders, edit mode ────────────────────────────
const dockLayout = (page) => page.evaluate(() => window.harness.kernel.dock());
const tiles = (page) => page.locator('.tos-dock').evaluate(el => [...el.querySelectorAll('[data-icon], [data-folder]')].filter(t => !t.closest('.tos-dock-folder-panel')).map(t => t.dataset.folder ? `[${t.title}]` : t.dataset.icon));

test("one page's screens arrive as launch entries in the folders its manifest names, and open at their screen", async ({ page }) => {
  await host(page, 'modules=2&dock=1', { width: 1280, height: 800 });
  expect(await tiles(page)).toEqual(['screen-1', 'screen-2', '[People]', '[Planning]', 'suite/home']);
  await page.locator('.tos-dock [data-folder="people"]').click();
  const panel = page.locator('.tos-dock-folder-panel');
  await expect(panel.getByRole('heading', { name: 'People' })).toBeVisible();
  await panel.getByRole('button', { name: 'Leave' }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('.tos-window[data-module="suite"] .tos-content')).toHaveText('Suite: leave');
  // another entry of a running suite shows its screen in the same window
  await page.locator('.tos-dock [data-icon="suite/home"]').click();
  await expect(page.locator('.tos-window[data-module="suite"] .tos-content')).toHaveText('Suite: home');
  expect(await page.evaluate(() => window.harness.desktop.state().windows.filter(w => w.module === 'suite').length)).toBe(1);
  await expect(page.locator('.tos-dock [data-folder="people"]')).toHaveClass(/is-running/);
});

test('in edit mode the person hides, shows, folds, takes out, renames and moves icons by menu and keyboard, and it is kept', async ({ page }) => {
  // without the wiggle: reduced motion marks movable tiles with an outline instead, and keeps them still to click
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await host(page, 'modules=3&dock=1', { width: 1280, height: 800 });
  await page.locator('.tos-dock [data-icon="screen-1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit the dock' }).click();
  await expect(page.locator('.tos-dock')).toHaveClass(/is-editing/);
  // a tap in edit mode launches nothing
  await page.locator('.tos-dock [data-icon="screen-2"]').click();
  expect(await page.evaluate(() => window.harness.desktop.state().windows.length)).toBe(0);
  // hide by its badge, show from the hidden icons
  await page.getByRole('button', { name: 'Hide Screen 3' }).click();
  expect(await tiles(page)).not.toContain('screen-3');
  await page.getByRole('button', { name: 'Hidden icons' }).click();
  await page.getByRole('menuitem', { name: 'Show Screen 3' }).click();
  expect((await tiles(page)).at(-1)).toBe('screen-3');
  // a folder of two from the menu, renamed in its panel
  await page.locator('.tos-dock [data-icon="screen-1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Make a folder with Screen 2' }).click();
  const folder = page.locator('.tos-dock [data-folder]').first();
  await folder.click();
  const name = page.getByRole('textbox', { name: 'Folder name' });
  await name.fill('Screens');
  await name.press('Enter');
  await expect(page.locator('.tos-dock [data-folder]').first()).toHaveAttribute('title', 'Screens');
  // take one out again from its panel: a folder of one dissolves
  await page.locator('.tos-dock-folder-panel [data-icon="screen-2"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Take out of the folder' }).click();
  expect(await tiles(page)).toEqual(['screen-1', '[People]', '[Planning]', 'suite/home', 'screen-3', 'screen-2']);
  // Alt with an arrow key moves the focused tile; Escape is done
  await page.locator('.tos-dock [data-icon="screen-2"]').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  expect((await tiles(page)).slice(-2)).toEqual(['screen-2', 'screen-3']);
  await page.keyboard.press('Escape');
  await expect(page.locator('.tos-dock')).not.toHaveClass(/is-editing/);
  // the arrangement is the person's: a reload keeps it
  const kept = await dockLayout(page);
  await page.reload();
  await page.waitForFunction(() => window.harness);
  expect(await dockLayout(page)).toEqual(kept);
  expect(await tiles(page)).toEqual(['screen-1', '[People]', '[Planning]', 'suite/home', 'screen-2', 'screen-3']);
});

test('dragging one icon onto another makes a folder, and beside it moves it', async ({ page }) => {
  await host(page, 'modules=3&dock=1', { width: 1280, height: 800 });
  await page.evaluate(() => { const t = document.querySelector('.tos-dock [data-icon="screen-1"]'); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 1, clientY: 1 })); });
  await page.getByRole('menuitem', { name: 'Edit the dock' }).click();
  const drag = async (from, to, x) => {
    const a = await page.locator(`.tos-dock [data-icon="${from}"]`).boundingBox(), b = await page.locator(to).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 3 });
    await page.mouse.move(b.x + b.width * x, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(50);
  };
  await drag('screen-3', '.tos-dock [data-icon="screen-1"]', 0.5);
  expect((await tiles(page))[0]).toMatch(/^\[/);
  await drag('suite/home', '.tos-dock [data-folder]:first-of-type', 0.05);
  expect((await tiles(page))[0]).toBe('suite/home');
  await page.screenshot({ path: test.info().outputPath('dock-editing.png') });
});

test("the assistant's suggested dock waits in the inbox until the person accepts it", async ({ page }) => {
  await host(page, 'modules=2&dock=1', { width: 1280, height: 800 });
  const filed = await page.evaluate(async () => {
    const read = await window.harness.kernel.call('assistant', 'tangle_os_dock', 'dock.read', {});
    const layout = { ...read.value.layout, hidden: ['screen-2'] };
    return window.harness.kernel.call('assistant', 'tangle_os_dock', 'dock.suggest', { layout });
  });
  expect(filed.ok).toBe(true);
  expect(await tiles(page)).toContain('screen-2');
  await page.locator('.tos-dock-mail').click();
  const suggestion = page.locator('.tos-proposal', { hasText: 'A new arrangement of the dock' });
  await expect(suggestion).toContainText('Hides: Screen 2');
  await suggestion.getByRole('button', { name: 'Accept' }).click();
  await expect.poll(() => tiles(page)).not.toContain('screen-2');
});

test("with a server, the person's dock follows them to another browser, and a change that cannot be saved says so", async ({ page, browser }) => {
  await host(page, 'modules=3&dock=1&state=server', { width: 1280, height: 800 });
  await page.waitForFunction(() => window.harness.kernel.stateStatus().status === 'ready');
  await page.evaluate(async () => {
    const { kernel } = window.harness;
    const layout = kernel.dockView().layout;
    kernel.setDock({ ...layout, items: [...layout.items].reverse() });
    await kernel.flushState();
  });
  const arranged = await tiles(page);
  // a fresh browser has none of this one's storage: what it shows came from the server
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await other.newPage();
  await second.goto(`${origin}/?modules=3&dock=1&state=server`);
  await second.waitForFunction(() => window.harness?.kernel.stateStatus().status === 'ready');
  expect(await tiles(second)).toEqual(arranged);
  expect(repository.rows().map(r => [r.owner, r.key])).toEqual([['person:ann', 'dock']]);
  await other.close();
  // the server goes away: the change stays on screen, and the dock says it was not saved
  stateDown = true;
  try {
    await page.evaluate(() => { const { kernel } = window.harness; kernel.setDock({ ...kernel.dockView().layout, hidden: ['screen-1'] }); });
    await expect(page.locator('.tos-dock-state')).toBeVisible();
    expect(await tiles(page)).not.toContain('screen-1');
  } finally { stateDown = false; }
  await page.locator('.tos-dock-state').click();
  await expect(page.locator('.tos-dock-state')).toHaveCount(0);
  expect(repository.rows()[0].value.hidden).toEqual(['screen-1']);
});

// ── Files ─────────────────────────────────────────────────────────────────
test('"This browser" answers the file location conformance suite in a real browser', async ({ page }) => {
  await host(page, 'modules=1', { width: 1280, height: 800 });
  expect((await page.evaluate(() => window.harness.conformOpfs())).length).toBe(14);
});

test("Files browses the person's own files and an application's, previews them safely, and keeps the assistant to reading", async ({ page }) => {
  await host(page, 'modules=1&framed=1&files=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.clearFiles());
  await page.evaluate(() => window.harness.desktop.open('files'));
  const win = page.locator('.tos-window[data-module="files"]');
  const bar = win.locator('.tos-titlebar');
  await expect(win.locator('.tos-files-location', { hasText: 'This browser' })).toHaveAttribute('aria-current', 'true');
  await expect(win.locator('.tos-files-status')).toHaveText('This folder is empty.');
  // a new folder, named in place
  await bar.getByRole('button', { name: 'New folder' }).click();
  const rename = win.getByRole('textbox', { name: 'Rename' });
  await rename.fill('Notes');
  await rename.press('Enter');
  await expect(win.locator('.tos-files-entry', { hasText: 'Notes' })).toHaveAttribute('data-kind', 'folder');
  // into it, and an upload from the person's computer
  await win.locator('.tos-files-entry', { hasText: 'Notes' }).dblclick();
  await expect(win.locator('.tos-files-crumbs')).toHaveText(/This browser\s*›\s*Notes/);
  const choosing = page.waitForEvent('filechooser');
  await bar.getByRole('button', { name: 'Files menu' }).click();
  await page.getByRole('menuitem', { name: 'Upload files…' }).click();
  await (await choosing).setFiles([{ name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from('# Plan\n<img src=x onerror=alert(1)>\n') }]);
  await win.locator('.tos-files-entry', { hasText: 'plan.md' }).click();
  // a file never becomes the desktop's markup: no previewer here, so the text is text
  await expect(win.locator('.tos-files-text')).toContainText('<img src=x onerror=alert(1)>');
  expect(await win.locator('.tos-files-preview img').count()).toBe(0);
  // rename with F2, then delete after asking
  await win.locator('.tos-files-entry', { hasText: 'plan.md' }).press('F2');
  await win.getByRole('textbox', { name: 'Rename' }).fill('plan-v2.md');
  await win.getByRole('textbox', { name: 'Rename' }).press('Enter');
  await expect(win.locator('.tos-files-entry', { hasText: 'plan-v2.md' })).toBeVisible();
  await win.locator('.tos-files-entry', { hasText: 'plan-v2.md' }).click();
  await win.locator('.tos-files-actions').getByRole('button', { name: 'Delete' }).click();
  await win.locator('.tos-files-confirm').getByRole('button', { name: 'Delete' }).click();
  await expect(win.locator('.tos-files-status')).toHaveText('This folder is empty.');
  // up again by the breadcrumb
  await win.locator('.tos-files-crumb', { hasText: 'This browser' }).click();
  await expect(win.locator('.tos-files-entry', { hasText: 'Notes' })).toBeVisible();

  // an application's files, from its own origin: a text inline, an image at an address it signed
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  await win.locator('.tos-files-location', { hasText: 'Echo files' }).click();
  await win.locator('.tos-files-entry', { hasText: 'hello.txt' }).click();
  await expect(win.locator('.tos-files-text')).toHaveText('hello, echo');
  await win.locator('.tos-files-entry', { hasText: 'logo.png' }).click();
  await expect.poll(() => win.locator('img.tos-files-image').evaluate(i => i.naturalWidth).catch(() => 0)).toBe(16);
  await expect(bar.getByRole('button', { name: 'New folder' })).toBeDisabled();

  // the assistant reads through tangle_os_files and never writes a location, even granted it by name
  const read = await page.evaluate(() => window.harness.kernel.call('assistant', 'tangle_os_files', 'files.read', { location: 'echo_files', id: 'hello' }));
  expect(read.value.text).toBe('hello, echo');
  const write = await page.evaluate(() => window.harness.kernel.call('assistant', 'tangle_os_files_browser', 'files.mkdir', { name: 'x' }));
  expect([write.ok, write.error?.code]).toEqual([false, 'OS0101']);
  await page.screenshot({ path: test.info().outputPath('files.png') });
});

test('a file opens in the application the person picks, starting it when it is not running', async ({ page }) => {
  await host(page, 'modules=1&framed=1&files=1', { width: 1280, height: 800 });
  await page.evaluate(async () => {
    await window.harness.clearFiles();
    await window.harness.kernel.call('shell', 'tangle_os_files_browser', 'files.write', { name: 'note.txt', data: btoa('hi echo'), type: 'text/plain' });
    window.harness.desktop.open('files');
  });
  const win = page.locator('.tos-window[data-module="files"]');
  await win.locator('.tos-files-entry', { hasText: 'note.txt' }).click();
  await win.locator('.tos-files-actions').getByRole('button', { name: 'Open in Echo' }).click();
  // Echo was not running: its window opened, it joined from its own origin, and then it got the file
  await expect(page.locator('.tos-window[data-module="echo-app"]')).toBeVisible();
  await expect(page.frameLocator('.tos-window[data-module="echo-app"] iframe').locator('body')).toHaveAttribute('data-opened', 'note.txt: hi echo');
  expect(await page.evaluate(() => window.harness.desktop.state().focus)).toBe(await page.evaluate(() => window.harness.desktop.state().windows.find(w => w.module === 'echo-app').id));
});

test('a paused run waits in the inbox as a form; the answer reaches its application, and a reload files it again', async ({ page }) => {
  await host(page, 'modules=1&framed=1&pause=1', { width: 1280, height: 800 });
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  await expect.poll(() => page.evaluate(() => window.harness.kernel.mail().some(m => m.proposal?.id === 'echo-pause'))).toBe(true);
  await page.locator('.tos-dock-mail').click();
  const pause = page.locator('.tos-proposal', { hasText: 'How many crates for the weekly order?' });
  await expect(pause.locator('.tos-proposal-origin')).toHaveText('Proposed by the assistant');
  // a value the run's schema refuses is not sent
  await pause.getByLabel('Crates').fill('-2');
  await pause.getByRole('button', { name: 'Send' }).click();
  await expect(pause.getByRole('alert')).toContainText('Not sent');
  await pause.getByLabel('Crates').fill('12');
  await pause.getByLabel('Rush delivery').check();
  await pause.getByRole('button', { name: 'Send' }).click();
  await expect(page.frameLocator('.tos-window[data-module="echo-app"] iframe').locator('body')).toHaveAttribute('data-decided', 'echo-pause:answer:{"crates":12,"rush":true}');
  // the page reloads: the inbox lives as long as the page, and the application files what still waits
  await page.reload();
  await page.waitForFunction(() => window.harness);
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  await expect.poll(() => page.evaluate(() => window.harness.kernel.mail().find(m => m.proposal?.id === 'echo-pause')?.proposal?.status)).toBe('pending');
});

test("two capabilities' proposals and pauses wait in one inbox, one filed with no window open, and no model client in the page", async ({ page }) => {
  await host(page, 'modules=1&framed=1&caps=1', { width: 1280, height: 800 });
  // no window is open: the host filed the paused run at boot
  expect(await page.evaluate(() => window.harness.desktop.state().windows.length)).toBe(0);
  await page.evaluate(() => window.harness.desktop.open('echo-app'));
  await expect.poll(() => page.evaluate(() => window.harness.kernel.mail().filter(m => m.proposal?.status === 'pending').map(m => m.proposal.id).sort())).toEqual(['count-1', 'echo-1', 'echo-2', 'po-cola', 'weekly-order']);
  await page.locator('.tos-dock-mail').click();
  const mail = page.locator('.tos-mail');
  await expect(mail.locator('.tos-proposal', { hasText: 'Order 12 crates of cola' }).locator('.tos-proposal-roles')).toHaveText('For: buyer');
  await expect(mail.locator('.tos-proposal', { hasText: 'Count of shelf B differs by 3' }).locator('.tos-proposal-origin')).toHaveText('From an import');
  const pause = mail.locator('.tos-proposal', { hasText: 'How many crates of cola this week?' });
  await pause.getByLabel('Crates').fill('20');
  await pause.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => page.evaluate(() => window.harness.decided)).toEqual([{ id: 'weekly-order', kind: 'run.pause', decision: 'answer', revision: '0', response: { crates: 20 } }]);
  // the capability decides who may file: an import may not propose a purchase order
  const refused = await page.evaluate(() => window.harness.kernel.propose('screen-1', { id: 'po-import', kind: 'purchase.order', title: 'x', origin: 'import' }));
  expect(refused.error.code).toBe('OS0133');
  // the page that shows all this carries no model client
  const bundle = await (await page.request.get(`${origin}/main.js`)).text();
  expect(bundle).not.toContain('chat/completions');
  expect(bundle).not.toContain('createChatClient');
});
