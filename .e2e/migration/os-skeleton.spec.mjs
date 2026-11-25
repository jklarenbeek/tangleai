/**
 * The Tangle OS skeleton in a real browser: a shipped component, a document
 * module in a sandboxed frame, and a neutral application from a second origin
 * that joins through the package's module entry — windows, theme, the
 * contract bus, mail, assistant tools, isolation, focus across frames and a
 * drag across a frame.
 */
import { test, expect } from './playwright.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let server, suiteUrl;
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, info) => {
  const base = new URL(info.project.use.baseURL ?? 'http://127.0.0.1:4715');
  const port = 4720 + info.workerIndex;
  server = spawn(process.execPath, [fileURLToPath(new URL('../../test/fixtures/os-suite/serve.mjs', import.meta.url)), String(port), base.origin], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (chunk) => { if (String(chunk).includes('fixture suite on')) resolve(); });
    server.on('exit', (code) => reject(new Error(`fixture server exited ${code}`)));
  });
  suiteUrl = `http://127.0.0.1:${port}/suite.json`;
});
test.afterAll(() => server?.kill());

async function desktop(page) {
  // a returning visitor: Welcome greets only on a first visit
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto(`/?suite=${encodeURIComponent(suiteUrl)}`);
  // the link installs nothing by itself: the person adds the catalogue, and lets the assistant use it
  const sheet = page.locator('.tos-join');
  await sheet.locator('.tos-join-app[data-module="catalogue"] .tos-join-ai').check();
  await sheet.getByRole('button', { name: 'Add' }).click();
  await page.waitForFunction(() => window.tangleOs?.kernel.modules().some(m => m.id === 'catalogue'));
  await page.evaluate(() => ['about', 'todo', 'catalogue'].map(id => window.tangleOs.desktop.open(id)));
  await page.waitForFunction(() => window.tangleOs.kernel.providers().some(p => p.contract === 'records'));
}

test('three host kinds join one desktop and talk only through contracts', async ({ page }) => {
  await desktop(page);
  await expect(page.locator('.tos-window')).toHaveCount(3);
  // every module is in the dock: an icon of its own, in a folder, or hidden; the dock draws what its view holds
  const dock = await page.evaluate(() => {
    const view = window.tangleOs.kernel.dockView();
    const placed = [...view.items.flatMap(i => i.icon ? [i.icon.id] : i.icons.map(x => x.id)), ...view.hidden.map(i => i.id)];
    return { placed, top: view.items.length, modules: window.tangleOs.kernel.modules().map(m => m.id) };
  });
  for (const id of dock.modules) expect(dock.placed.some(p => p === id || p.startsWith(`${id}/`)), id).toBe(true);
  await expect(page.locator('.tos-dock-item[data-icon], .tos-dock-folder')).toHaveCount(dock.top);

  const found = await page.evaluate(() => window.tangleOs.kernel.call('shell', 'records', 'records.search', { query: 'oak' }));
  expect(found).toEqual({ ok: true, value: [{ id: 'r1', name: 'Oak table', stock: 4 }] });
  expect(await page.evaluate(() => window.tangleOs.kernel.tools().list().map(t => t.name).sort()))
    // every window's header bar is the assistant's too, under the same grant
    .toEqual(['records__records_describe', 'records__records_get', 'records__records_search', 'tangle_os_apps__apps_check', 'tangle_os_apps__apps_crib', 'tangle_os_apps__apps_read', 'tangle_os_apps__apps_revise', 'tangle_os_apps__apps_suggest', 'tangle_os_dock__dock_read', 'tangle_os_dock__dock_suggest', 'tangle_os_files__files_list', 'tangle_os_files__files_locations', 'tangle_os_files__files_read', 'tangle_os_files__files_search', 'tangle_os_header__header_activate', 'tangle_os_header__header_list', 'tangle_os_jobs__jobs_counts', 'tangle_os_jobs__jobs_events', 'tangle_os_jobs__jobs_get', 'tangle_os_jobs__jobs_health', 'tangle_os_jobs__jobs_page', 'tangle_os_jobs__jobs_registry', 'tangle_os_jobs__jobs_schedules', 'tangle_os_jobs__jobs_scopes', 'tangle_os_jobs__jobs_suggest', 'tangle_os_web__web_read', 'tangle_os_web__web_search']);

  const catalogue = page.frameLocator('.tos-window[data-module="catalogue"] iframe');
  await expect(catalogue.locator('#status')).toHaveText('Joined the desktop as catalogue.');
  const accent = await page.evaluate(() => getComputedStyle(document.getElementById('desktop')).getPropertyValue('--accent').trim());
  const toRgb = (hex) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  await expect(catalogue.locator('h1')).toHaveCSS('color', toRgb(accent));

  await page.evaluate(() => window.tangleOs.desktop.focus('w3'));
  await catalogue.locator('#mail').click();
  await page.evaluate(() => window.tangleOs.desktop.focus('w2'));
  const todo = page.frameLocator('.tos-window[data-module="todo"] iframe');
  await todo.getByRole('button', { name: 'Mail me a summary' }).click();
  await expect(todo.getByRole('button', { name: 'Summary sent' })).toBeVisible();
  await page.waitForFunction(() => window.tangleOs.kernel.mail().length === 2);
  expect(await page.evaluate(() => window.tangleOs.kernel.mail().map(m => [m.from, m.subject]))).toEqual([['catalogue', '1 out of stock'], ['todo', '1 tasks open']]);
  await expect(page.locator('.tos-dock-mail .tos-badge')).toHaveText('2');
  await page.locator('.tos-dock-mail').click();
  await expect(page.locator('.tos-mail li')).toHaveCount(2);
  await expect(page.locator('.tos-dock-mail .tos-badge')).toHaveCount(0);
});

test('the theme reaches both frames, and a switch reaches them again', async ({ page }) => {
  await desktop(page);
  const catalogue = page.frameLocator('.tos-window[data-module="catalogue"] iframe');
  const todo = page.frameLocator('.tos-window[data-module="todo"] iframe');
  await expect(catalogue.locator('#status')).toHaveText('Joined the desktop as catalogue.');
  await expect(todo.getByRole('heading', { name: 'To do' })).toBeVisible();
  const tokens = async () => ({
    shell: await page.evaluate(() => getComputedStyle(document.getElementById('desktop')).getPropertyValue('--surface').trim()),
    catalogue: await catalogue.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--surface').trim()),
    todo: await todo.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--surface').trim()),
    todoBody: await todo.locator('body').evaluate(el => getComputedStyle(el).backgroundColor),
  });
  const before = await tokens();
  expect([before.catalogue, before.todo]).toEqual([before.shell, before.shell]);
  await page.locator('.tos-dock-theme').click();
  await expect.poll(async () => (await tokens()).todo).not.toBe(before.todo);
  const after = await tokens();
  expect(after.shell).not.toBe(before.shell);
  expect([after.catalogue, after.todo]).toEqual([after.shell, after.shell]);
  expect(after.todoBody).not.toBe(before.todoBody);
});

test('a link installs nothing until the person adds it, and what they add stays theirs to change', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto(`/?suite=${encodeURIComponent(suiteUrl)}`);
  const sheet = page.locator('.tos-join');
  const offered = sheet.locator('.tos-join-app[data-module="catalogue"]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  // the workers' fixture servers share one suite file, so the page may be another worker's port
  await expect(offered.locator('.tos-join-origin')).toHaveText(/^Runs from http:\/\/127\.0\.0\.1:\d+$/);
  await expect(offered.locator('.tos-join-provides')).toHaveText('Offers: records');
  await expect(offered.locator('.tos-join-ai')).not.toBeChecked();
  // opened by a link: a stray Enter cancels, it never consents
  await expect(sheet.getByRole('button', { name: 'Cancel' })).toBeFocused();
  // cancelled: nothing joins
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(async () => (await window.tangleOs.suites)[0])).toEqual({ installed: [], declined: ['catalogue'], unchanged: [], refused: [] });
  expect(await page.evaluate(() => window.tangleOs.kernel.layerOf('catalogue'))).toBe(null);

  // added without the assistant: the person reaches it, the assistant does not, on a desktop that grants it everything else
  await page.reload();
  await page.locator('.tos-join').getByRole('button', { name: 'Add' }).click();
  expect(await page.evaluate(async () => (await window.tangleOs.suites)[0].installed)).toEqual(['catalogue']);
  await page.evaluate(() => window.tangleOs.desktop.open('catalogue'));
  await page.waitForFunction(() => window.tangleOs.kernel.providers().some(p => p.contract === 'records'));
  expect(await page.evaluate(() => window.tangleOs.kernel.tools().list().map(t => t.name).filter(n => n.startsWith('records')))).toEqual([]);
  expect((await page.evaluate(() => window.tangleOs.kernel.call('assistant', 'records', 'records.search', { query: 'oak' }))).ok).toBe(false);
  expect((await page.evaluate(() => window.tangleOs.kernel.call('shell', 'records', 'records.search', { query: 'oak' }))).ok).toBe(true);

  // the next visit asks nothing: the person's state kept it
  await page.reload();
  expect(await page.evaluate(async () => (await window.tangleOs.suites)[0].unchanged)).toEqual(['catalogue']);
  await expect(page.locator('.tos-join')).toHaveCount(0);

  // Settings → Applications and access: the person lets the assistant use it, sees its calls, then removes it
  await page.evaluate(() => window.tangleOs.desktop.openSettings());
  await page.locator('.tos-settings-nav [data-section="access"]').click();
  const item = page.locator('.tos-access-item[data-module="catalogue"]');
  await expect(item.locator('.tos-access-layer')).toHaveText('Added by you');
  await expect(page.locator('.tos-access-item[data-module="todo"] .tos-access-layer')).toHaveText('Part of this desktop');
  await item.locator('.tos-access-ai').check();
  await page.waitForFunction(() => window.tangleOs.kernel.consentOf('catalogue')?.assistant === true);
  await page.evaluate(() => window.tangleOs.desktop.open('catalogue'));
  await page.waitForFunction(() => window.tangleOs.kernel.providers().some(p => p.contract === 'records'));
  expect((await page.evaluate(() => window.tangleOs.kernel.call('assistant', 'records', 'records.search', { query: 'oak' }))).ok).toBe(true);
  await page.evaluate(() => window.tangleOs.desktop.focus(window.tangleOs.desktop.state().windows.find(w => w.module === 'settings').id));
  await item.locator('summary').click();
  await expect(item.locator('.tos-access-calls li').first()).toContainText('assistant called records.records.search');
  await item.getByRole('button', { name: 'Remove' }).click();
  await expect(item.getByRole('button', { name: 'Keep' })).toBeFocused();
  await item.getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction(() => window.tangleOs.kernel.layerOf('catalogue') === null);
  await page.reload();
  await expect(page.locator('.tos-join')).toBeVisible();
});

test('a link grants nothing, and an application on the desktop\'s own origin is refused', async ({ page }) => {
  await desktop(page);
  expect(await page.evaluate(() => window.tangleOs.kernel.grants().catalogue ?? [])).toEqual([]);
  const sameOrigin = await page.evaluate(() => {
    const { kernel, desktop } = window.tangleOs;
    kernel.install({ $module: '0.1', id: 'same', version: '1.0.0', title: { en: 'Same origin' }, host: { kind: 'origin', url: `${location.origin}/index.html` } }, 'suite', { grant: false });
    const id = desktop.open('same');
    return { id, frames: document.querySelectorAll(`[data-window="${id}"] iframe`).length, text: document.querySelector(`[data-window="${id}"] .tos-content`).textContent };
  });
  expect(sameOrigin.frames).toBe(0);
  expect(sameOrigin.text).toContain("shares the desktop's origin");
});

test('a document module runs in an opaque origin that cannot reach the desktop\'s storage', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => localStorage.setItem('tangle-ai', JSON.stringify({ apiKey: 'desktop-only-key' })));
  const todo = page.frameLocator('.tos-window[data-module="todo"] iframe');
  await expect(todo.getByRole('heading', { name: 'To do' })).toBeVisible();
  const inside = await todo.locator('body').evaluate(() => {
    let storage; try { storage = localStorage.getItem('tangle-ai'); } catch { storage = 'refused'; }
    let parentDom; try { parentDom = window.parent.document.title; } catch { parentDom = 'refused'; }
    return { origin: self.origin, storage, parentDom };
  });
  expect(inside).toEqual({ origin: 'null', storage: 'refused', parentDom: 'refused' });
});

test('a press inside any window raises it, and a drag across a frame keeps the pointer', async ({ page }) => {
  await desktop(page);
  const visible = (selector) => page.evaluate((selector) => {
    const el = document.querySelector(selector); const r = el.getBoundingClientRect();
    for (let y = r.top + 10; y < Math.min(r.bottom, innerHeight) - 5; y += 12) for (let x = r.left + 10; x < Math.min(r.right, innerWidth) - 5; x += 12) {
      const hit = document.elementFromPoint(x, y); if (hit === el || el.contains(hit)) return [x, y];
    }
    return null;
  }, selector);
  for (const [module, id, from] of [['todo', 'w2', 'w1'], ['catalogue', 'w3', 'w2'], ['about', 'w1', 'w3']]) {
    await page.evaluate((from) => window.tangleOs.desktop.focus(from), from);
    const point = await visible(`.tos-window[data-module="${module}"] .tos-content`);
    expect(point, `${module} has a visible point`).not.toBeNull();
    await page.mouse.click(point[0], point[1]);
    await expect.poll(() => page.evaluate(() => window.tangleOs.desktop.state().focus)).toBe(id);
  }
  // drag the About window's title bar across the catalogue's frame
  await page.evaluate(() => window.tangleOs.desktop.focus('w1'));
  const bar = await page.locator('.tos-window[data-module="about"] .tos-title').boundingBox();
  const frame = await page.locator('.tos-window[data-module="catalogue"] iframe').boundingBox();
  const before = await page.evaluate(() => window.tangleOs.desktop.state().windows.find(w => w.id === 'w1').rect);
  await page.mouse.move(bar.x + 20, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2, { steps: 16 });
  await page.mouse.move(frame.x + frame.width / 2 + 60, frame.y + frame.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.tangleOs.desktop.state().windows.find(w => w.id === 'w1').rect);
  const expected = { dx: Math.round(frame.x + frame.width / 2 + 60 - (bar.x + 20)), dy: Math.round(frame.y + frame.height / 2 + 30 - (bar.y + bar.height / 2)) };
  expect(Math.abs(after.x - before.x - expected.dx)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y - expected.dy)).toBeLessThanOrEqual(2);
  await expect(page.locator('.tos-shield')).toBeHidden();
});

test('a right click opens the shell\'s menu on the desktop, a title bar and a dock item, never inside a window', async ({ page }) => {
  await desktop(page);
  const menu = page.locator('.tos-menu');

  // the title bar: the window's own commands, and minimize works from there
  await page.evaluate(() => window.tangleOs.desktop.focus('w2'));
  await page.locator('.tos-window[data-module="todo"] .tos-title').click({ button: 'right' });
  await expect(menu).toHaveAttribute('aria-label', 'Menu for To do');
  await expect(menu.getByRole('menuitem')).toHaveText(['Minimize', 'Maximize', 'New window', 'Close']);
  await expect(menu.getByRole('menuitem', { name: 'Minimize' })).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Minimize' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.tos-window[data-module="todo"]')).toBeHidden();

  // the dock: the module's windows, a new one, and closing them
  await page.locator('.tos-dock-item[data-module="todo"]').click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['To do', 'New window', 'Close', 'Edit the dock']);
  await menu.getByRole('menuitem', { name: 'New window' }).click();
  await expect(page.locator('.tos-window[data-module="todo"]')).toHaveCount(2);
  await page.locator('.tos-dock-item[data-module="todo"]').click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['To do', 'To do', 'New window', 'Close all windows', 'Edit the dock']);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // a singleton offers no second window (Settings stands in the dock itself; About sits in a folder)
  await page.evaluate(() => window.tangleOs.desktop.open('settings'));
  await page.locator('.tos-dock-item[data-module="settings"]').click({ button: 'right' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Settings', 'Close', 'Edit the dock']);
  await menu.getByRole('menuitem', { name: 'Close' }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.tos-window[data-module="settings"]')).toHaveCount(0);

  // the desktop: every application, the windows, mail and the theme; arrows move, Enter runs
  await page.evaluate(() => { for (const w of window.tangleOs.desktop.state().windows) window.tangleOs.desktop.minimize(w.id); });
  await page.mouse.click(300, 200, { button: 'right' });
  await expect(menu).toHaveAttribute('aria-label', 'Menu for Desktop');
  const titles = await page.evaluate(() => window.tangleOs.kernel.modules().map(m => m.title.en));
  await expect(menu.getByRole('menuitem')).toHaveText([...titles, 'Show the desktop', 'Show all windows', 'Close all windows', 'Mail', /Switch to the (light|dark) theme/, 'Edit the dock']);
  await expect(menu.getByRole('menuitem', { name: 'Show the desktop' })).toBeDisabled();
  // from the first application, past the rest and the disabled item
  for (let i = 0; i < titles.length; i++) await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Show all windows' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.tos-window:visible')).toHaveCount(4);
  await expect(menu).toHaveCount(0);

  // inside a window's content the browser keeps its own menu
  await page.evaluate(() => window.tangleOs.desktop.focus('w1'));
  await page.locator('.tos-window[data-module="about"] .tos-about h1').click({ button: 'right' });
  await expect(menu).toHaveCount(0);
});

test('the OpenRouter key: entered in Settings, remembered, sent only to OpenRouter, and seen by nothing else', async ({ page }) => {
  const KEY = 'sk-or-v1-test-0123456789abcdef';
  const seen = [];
  page.on('request', (request) => {
    const headers = request.headers();
    seen.push({ host: new URL(request.url()).host, carries: [request.url(), JSON.stringify(headers), request.postData() ?? ''].some(text => text.includes(KEY)) });
  });
  const chats = [];
  await page.route('https://openrouter.ai/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/models')) return route.fulfill({ json: { data: [
      { id: 'anthropic/claude-haiku-5.5', name: 'Anthropic: Claude Haiku 5.5', context_length: 1000000, pricing: { prompt: '0.0000001', completion: '0.0000005' }, supported_parameters: ['tools'] },
      { id: 'qwen/qwen3.8-27b', name: 'Qwen: Qwen3.8 27B', context_length: 1000000, pricing: { prompt: '0.00000015', completion: '0.0000019' }, supported_parameters: ['tools'] },
      { id: 'example/no-tools', name: 'Example: No tools', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
    ] } });
    if (url.pathname.endsWith('/key')) return route.fulfill({ status: request.headers().authorization === `Bearer ${KEY}` ? 200 : 401, json: { data: { usage: 0.12, limit: 5, is_free_tier: false } } });
    if (url.pathname.endsWith('/chat/completions')) {
      const body = JSON.parse(request.postData());
      chats.push({ authorization: request.headers().authorization, model: body.model, tools: (body.tools ?? []).map(t => t.function?.name) });
      const toolTurn = !body.messages.some(m => m.role === 'tool');
      const message = toolTurn
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'records__records_search', arguments: JSON.stringify({ query: 'oak' }) } }] }
        : { role: 'assistant', content: `The catalogue has the Oak table, ${/"stock":\s*(\d+)/.exec(String(body.messages.findLast(m => m.role === 'tool').content))?.[1] ?? '?'} in stock.` };
      return route.fulfill({ json: { id: 'r', model: body.model, choices: [{ index: 0, message, finish_reason: toolTurn ? 'tool_calls' : 'stop' }] } });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('settings'));
  const settings = page.locator('.tos-window[data-module="settings"]');
  await settings.locator('[data-section="providers"]').click();
  // OpenRouter asks for a region, not a base URL
  await expect(settings.locator('#tos-region option')).toHaveText(['Any region (default)', 'Europe · eu.openrouter.ai', 'United States · us.openrouter.ai']);
  await expect(settings.locator('#tos-base-url')).toHaveCount(0);
  await expect(settings.locator('#tos-key')).toHaveAttribute('type', 'password');
  await settings.locator('#tos-key').fill(KEY);
  await settings.getByRole('button', { name: 'Save key' }).click();
  await expect(settings.getByRole('status')).toHaveText('OpenRouter key saved in this browser.');
  await settings.getByRole('button', { name: 'Check key' }).click();
  await expect(settings.getByRole('status')).toContainText('The key works · $0.12 used of $5.00');

  // the model picker lists the catalogue (tool-capable only by default) and saves the choice
  await settings.locator('[data-section="model"]').click();
  await expect(settings.locator('.tos-model[data-model]')).toHaveCount(2);
  await settings.locator('.tos-model[data-model="qwen/qwen3.8-27b"]').click();
  await expect(settings.locator('.tos-chosen code')).toHaveText('qwen/qwen3.8-27b');
  // starred models from two providers; each provider keeps its own key
  await settings.locator('[data-star="qwen/qwen3.8-27b"]').click();
  await settings.locator('[data-section="providers"]').click();
  await settings.locator('#tos-provider').selectOption('venice');
  await expect(settings.locator('#tos-key')).toHaveValue('');
  await settings.locator('#tos-key').fill('venice-test-key');
  await settings.getByRole('button', { name: 'Save key' }).click();
  await expect(settings.locator('tr[data-provider="openrouter"] td').nth(1)).toHaveText('saved');
  await expect(settings.locator('tr[data-provider="venice"] td').nth(1)).toHaveText('saved');
  await settings.locator('#tos-provider').selectOption('openrouter');
  await expect(settings.locator('#tos-key')).toHaveValue(KEY);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tangle-ai')))).toEqual({ provider: 'openrouter', baseUrl: '', model: 'qwen/qwen3.8-27b', apiKey: 'sk-or-v1-test-0123456789abcdef' });

  // the assistant uses that model and key, and the desktop's applications as tools
  await page.evaluate(() => window.tangleOs.desktop.open('assistant'));
  const assistant = page.locator('.tos-window[data-module="assistant"]');
  await expect(assistant.locator('.tos-model-switch')).toHaveValue('openrouter:qwen/qwen3.8-27b');
  await assistant.locator('.ai-composer textarea').fill('Do we have an oak table?');
  await assistant.locator('.ai-composer button[type="submit"]').click();
  await expect(assistant.locator('.ai-msg.assistant').last()).toContainText('Oak table, 4 in stock');
  expect(chats.length).toBe(2);
  for (const chat of chats) {
    expect(chat.authorization).toBe(`Bearer ${KEY}`);
    expect(chat.model).toBe('qwen/qwen3.8-27b');
    expect(chat.tools).toContain('records__records_search');
  }

  // nothing else holds or carries the key
  expect(seen.filter(r => r.carries).map(r => r.host).every(host => host === 'openrouter.ai')).toBe(true);
  expect(seen.some(r => r.host !== 'openrouter.ai' && r.carries)).toBe(false);
  expect(seen.some(r => r.carries)).toBe(true);
  const elsewhere = await page.evaluate((key) => ({
    url: location.href.includes(key),
    text: document.body.innerText.includes(key),
    mail: JSON.stringify(window.tangleOs.kernel.mail()).includes(key),
    ledger: JSON.stringify(window.tangleOs.kernel.ledger()).includes(key),
    transcript: (localStorage.getItem('tangle-os-chat') ?? '').includes(key),
    desktop: (localStorage.getItem('tangle-os') ?? '').includes(key),
  }), KEY);
  expect(elsewhere).toEqual({ url: false, text: false, mail: false, ledger: false, transcript: false, desktop: false });
  const catalogue = page.frameLocator('.tos-window[data-module="catalogue"] iframe');
  expect(await catalogue.locator('body').evaluate(() => Object.values({ ...localStorage }).join(''))).not.toContain(KEY);

  // remembered across a reload; "remember" off keeps it for this tab only; forget removes it
  await page.reload();
  await page.waitForFunction(() => window.tangleOs?.kernel.modules().some(m => m.id === 'catalogue'));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tangle-ai')).apiKey)).toBe(KEY);
  await page.evaluate(() => window.tangleOs.desktop.open('settings'));
  await settings.locator('[data-section="providers"]').click();
  await expect(settings.locator('#tos-key')).toHaveValue(KEY);
  await settings.locator('#tos-remember').uncheck();
  expect(await page.evaluate(() => [JSON.parse(localStorage.getItem('tangle-ai')).apiKey, localStorage.getItem('tangle-os-providers').includes('sk-or-v1'), JSON.parse(sessionStorage.getItem('tangle-os-session-keys')).openrouter])).toEqual(['', false, KEY]);
  await page.reload();
  await page.waitForFunction(() => window.tangleOs?.kernel.modules().some(m => m.id === 'catalogue'));
  await page.evaluate(() => window.tangleOs.desktop.open('settings'));
  await settings.locator('[data-section="providers"]').click();
  await expect(settings.locator('#tos-key')).toHaveValue(KEY);
  await settings.getByRole('button', { name: 'Forget key' }).click();
  expect(await page.evaluate(() => [JSON.parse(localStorage.getItem('tangle-ai')).apiKey, JSON.parse(sessionStorage.getItem('tangle-os-session-keys') ?? '{}').openrouter ?? null, JSON.parse(sessionStorage.getItem('tangle-os-session-keys') ?? '{}').venice])).toEqual(['', null, 'venice-test-key']);
});

test('appearance: a theme kit, an accent and a pattern apply at once, survive a reload, and the dock switch keeps them', async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => window.tangleOs.desktop.open('settings'));
  const settings = page.locator('.tos-window[data-module="settings"]');
  await settings.locator('[data-section="appearance"]').click();
  await settings.locator('input[name="tos-scheme"][value="light"]').check();
  const token = (name) => page.evaluate((name) => getComputedStyle(document.getElementById('desktop')).getPropertyValue(name).trim(), name);
  const wallpaper = () => page.evaluate(() => document.querySelector('.tos-wallpaper').style.background);
  await settings.locator('.tos-kit[data-kit="topograph"]').click();
  expect(await token('--os-desktop')).toBe('contours');
  expect(await token('--accent')).toBe('#2f6f5e');
  expect(await wallpaper()).toContain('data:image/svg+xml');
  await settings.locator('.tos-swatch-btn[aria-label="#c81e64"]').click();
  expect(await token('--accent')).toBe('#c81e64');
  await settings.locator('.tos-pattern', { hasText: 'Moiré' }).click();
  expect(await token('--os-desktop')).toBe('moire');
  const light = await wallpaper();
  await page.locator('.tos-dock-theme').click();
  expect(await token('--accent')).toBe('#c81e64');
  expect(await token('--os-desktop')).toBe('moire');
  expect(await wallpaper()).not.toBe(light);
  await expect(settings.locator('input[name="tos-scheme"][value="dark"]')).toBeChecked();
  await page.reload();
  await page.waitForFunction(() => window.tangleOs?.kernel.modules().some(m => m.id === 'catalogue'));
  expect(await token('--accent')).toBe('#c81e64');
  expect(await token('--os-desktop')).toBe('moire');
});

test('the assistant offers an application it wrote; the person adds it from the inbox and it runs in a frame of its own', async ({ page }) => {
  const BILL = { $app: '0.1', state: { amount: 0 }, view: { $jslt: '0.1', rules: [{ match: '$', body: ['div', {},
    ['label', {}, 'Bill amount ', ['input', { type: 'number', on: { input: 'amount' } }]], ['p', { class: 'total' }, 'Total: ', '$.amount']] }] },
    actions: { amount: { patch: [{ op: 'replace', path: '/amount', value: { $number: '$event.value' } }] } } };
  await page.addInitScript(() => localStorage.setItem('tangle-os-welcomed', '1'));
  await page.goto('/');
  await page.waitForFunction(() => window.tangleOs?.kernel);
  const offered = await page.evaluate((doc) => window.tangleOs.kernel.call('assistant', 'tangle_os_apps', 'apps.suggest', { title: 'Bill splitter', summary: 'Splits a bill between friends.', doc }), BILL);
  expect(offered.ok).toBe(true);
  expect(await page.evaluate(() => window.tangleOs.kernel.modules().some(m => m.id === 'my-bill-splitter'))).toBe(false);
  await page.locator('.tos-dock-mail').click();
  const offer = page.locator('.tos-proposal').filter({ hasText: 'Add the application Bill splitter' });
  await expect(offer).toContainText('Splits a bill between friends.');
  await expect(offer).toContainText('asks for nothing');
  await offer.getByRole('button', { name: 'Accept' }).click();
  // added, opened, and running in a sandboxed frame of its own
  const win = page.locator('.tos-window[data-module="my-bill-splitter"]');
  await expect(win).toBeVisible();
  const app = page.frameLocator('.tos-window[data-module="my-bill-splitter"] iframe');
  await app.getByLabel('Bill amount').fill('12');
  await expect(app.locator('.total')).toHaveText('Total: 12');
  expect(await page.evaluate(() => window.tangleOs.kernel.grants()['my-bill-splitter'])).toEqual([]);
  // the assistant offers a new version against the revision it read; accepted, the window starts again on it
  const revised = await page.evaluate(async () => {
    const { kernel } = window.tangleOs;
    const read = await kernel.call('assistant', 'tangle_os_apps', 'apps.read', { module: 'my-bill-splitter' });
    const doc = structuredClone(read.value.doc);
    doc.view.rules[0].body[3][2] = 'Sum: ';
    return kernel.call('assistant', 'tangle_os_apps', 'apps.revise', { module: 'my-bill-splitter', revision: read.value.revision, summary: 'Says "Sum".', doc });
  });
  expect(revised.ok).toBe(true);
  if (!(await page.locator('.tos-mail').isVisible())) await page.locator('.tos-dock-mail').click();
  const change = page.locator('.tos-proposal').filter({ hasText: 'Change the application Bill splitter' });
  await change.getByRole('button', { name: 'Accept' }).click();
  const again = page.frameLocator('.tos-window[data-module="my-bill-splitter"] iframe');
  await again.getByLabel('Bill amount').fill('7');
  await expect(again.locator('.total')).toHaveText('Sum: 7');
  // the person's own now: there on the next visit
  await page.reload();
  await page.waitForFunction(() => window.tangleOs?.kernel.modules().some(m => m.id === 'my-bill-splitter'));
});
