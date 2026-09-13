import { test, expect } from './playwright.mjs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let bundle;
test.beforeAll(() => { bundle = execFileSync('bun', ['build', fileURLToPath(new URL('./host-fixture.ts', import.meta.url)), '--target=browser'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); });
async function boot(page) {
  await page.route('**/host-fixture.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.goto('/');
  await page.evaluate(async () => { await window.tanglePages.dispose(); window.hostApi = await import('/host-fixture.js'); });
}
test('the real host qualifies both roots, methods, receivers, overrides, discovery and ownership', async ({ page }) => {
  await boot(page);
  const receipts = await page.evaluate(async () => {
    const result = [], api = window.hostApi;
    const makeContext = method => {
      const tools = new Map([['foreign', { execute: () => 'foreign' }]]), calls = [], removed = [];
      const context = method === 'current' ? {
        async registerTool(tool) { if (this !== context) throw Error('receiver'); calls.push(tool.name); tools.set(tool.name, tool); },
        unregisterTool(name) { if (this !== context) throw Error('receiver'); removed.push(name); tools.delete(name); },
      } : {
        provideContext(value) { if (this !== context) throw Error('receiver'); calls.push(...value.tools.map(t => t.name)); value.tools.forEach(t => tools.set(t.name, t)); return () => { for (const t of value.tools) { removed.push(t.name); tools.delete(t.name); } }; },
      };
      return { context, tools, calls, removed };
    };
    async function check(label, realm, expected, others = [], webmcp) {
      const root = document.createElement('div'), assistantNode = document.createElement('div'); document.body.append(root, assistantNode);
      const diagnostics = [], host = api.mountPageHost({ root, assistantNode, realm, webmcp, onError: error => diagnostics.push(String(error)) });
      const ready = await host.webmcp.ready;
      const registered = expected ? expected.calls.length === 25 && ready.status === 'registered' : ready.status === 'unavailable';
      const tool = expected?.tools.get('jaren_validate');
      const valid = tool ? await tool.execute({ schema: { type: 'number' }, data: 3 }) : null;
      const invalid = tool ? await tool.execute({ schema: { type: 'number' }, data: 'wrong' }) : null;
      const old = tool; await host.dispose(); await host.dispose(); root.remove(); assistantNode.remove();
      result.push({ label, registered, valid: !tool || valid.valid === true, invalid: !tool || invalid.valid === false,
        owned: !expected || expected.tools.has('foreign') && expected.removed.length === 25,
        others: others.every(ctx => ctx.calls.length === 0), inactive: !old || Boolean((await old.execute({})).error), diagnostics: [...diagnostics, ...ready.diagnostics.filter(d => d.code === 'inaccessible')] });
    }
    for (const root of ['document', 'navigator']) for (const method of ['current', 'legacy']) {
      const ctx = makeContext(method); await check(root + '/' + method, { [root]: { modelContext: ctx.context } }, ctx);
    }
    for (const alias of [false, true]) {
      const doc = makeContext('current'), nav = alias ? doc : makeContext('legacy');
      await check('both/' + alias, { document: { modelContext: doc.context }, navigator: { modelContext: nav.context } }, doc, alias ? [] : [nav]);
    }
    for (const invalid of [undefined, null, {}, { registerTool: 1 }]) {
      const nav = makeContext('current'); await check('preferred/' + JSON.stringify(invalid), { document: { modelContext: invalid }, navigator: { modelContext: nav.context } }, nav);
    }
    for (const blocked of ['root', 'context', 'method']) {
      const nav = makeContext('legacy'), realm = { navigator: { modelContext: nav.context }, document: {} };
      if (blocked === 'root') Object.defineProperty(realm, 'document', { get() { throw Error('root denied'); } });
      if (blocked === 'context') Object.defineProperty(realm.document, 'modelContext', { get() { throw Error('context denied'); } });
      if (blocked === 'method') { realm.document.modelContext = {}; Object.defineProperty(realm.document.modelContext, 'registerTool', { get() { throw Error('method denied'); } }); }
      await check('inaccessible/' + blocked, realm, nav);
    }
    const ambient = makeContext('current'), override = makeContext('legacy'), realm = { document: { modelContext: ambient.context } };
    await check('override', realm, override, [ambient], { context: override.context });
    for (const context of [null, undefined, {}, { registerTool: 1 }]) await check('invalid override', realm, null, [ambient], { context });
    await check('no globals', {}, null);
    return result;
  });
  for (const receipt of receipts) {
    expect(receipt, receipt.label).toMatchObject({ registered: true, valid: true, invalid: true, owned: true, others: true, inactive: true });
    if (receipt.label.startsWith('inaccessible/')) expect(receipt.diagnostics.length).toBeGreaterThan(0);
  }
});
test('partial failure, pending disposal and late installation never leave active foreign or duplicate tools', async ({ page }) => {
  await boot(page);
  const receipts = await page.evaluate(async () => {
    const api = window.hostApi, results = [];
    const mount = (realm) => { const root = document.createElement('div'), assistantNode = document.createElement('div'); document.body.append(root, assistantNode);
      return api.mountPageHost({ root, assistantNode, realm, onError() {} }); };
    for (const root of ['document', 'navigator']) for (const asyncFailure of [false, true]) {
      let calls = 0, fallback = 0; const tools = [], removed = [];
      const context = { registerTool(tool) { calls++; if (calls === 3) { if (asyncFailure) return Promise.reject(Error('permission denied')); throw Error('permission denied'); } tools.push(tool); }, unregisterTool(name) { removed.push(name); } };
      const realm = { document: {}, navigator: {} }; realm[root].modelContext = context;
      if (root === 'document') realm.navigator.modelContext = { registerTool() { fallback++; } };
      const host = mount(realm), ready = { ...await host.webmcp.ready }; await host.dispose();
      results.push({ kind: 'partial', status: ready.status, calls, fallback, removed: removed.length, inactive: tools.every(tool => tool.execute({}).error) });
    }
    for (const root of ['document', 'navigator']) {
      let release; const waiting = new Promise(resolve => { release = resolve; }), tools = [], removed = [];
      const context = { registerTool(tool) { tools.push(tool); return waiting; }, unregisterTool(name) { removed.push(name); } };
      const host = mount({ [root]: { modelContext: context } });
      await Promise.resolve(); const closing = host.dispose(); release(); await closing; await host.dispose();
      results.push({ kind: 'pending', status: (await host.webmcp.ready).status, removed: removed.length, calls: tools.length, inactive: tools.every(tool => tool.execute({}).error) });
    }
    const realm = {}, host = mount(realm); const before = (await host.webmcp.ready).status;
    let registered = 0, removed = 0;
    realm.document = { modelContext: { registerTool() { registered++; }, unregisterTool() { removed++; } } };
    const after = (await host.refreshWebMcp()).status; realm.document.modelContext = { unregisterTool() { throw Error('wrong cleanup root'); } };
    await host.dispose(); results.push({ kind: 'late', before, after, registered, removed });
    // A documented unsupported result before any side effect may use the other method.
    let legacy = 0;
    const ctx = { registerTool() { return api.WEBMCP_UNSUPPORTED; }, provideContext({ tools }) { legacy = tools.length; return () => {}; } };
    const fallback = mount({ document: { modelContext: ctx } }); const fallbackReady = { ...await fallback.webmcp.ready }; await fallback.dispose();
    results.push({ kind: 'unsupported', status: fallbackReady.status, legacy });
    return results;
  });
  for (const r of receipts) {
    if (r.kind === 'partial') expect(r).toMatchObject({ status: 'failed', calls: 3, fallback: 0, removed: 2, inactive: true });
    if (r.kind === 'pending') { expect(r.inactive).toBeTruthy(); expect(r.removed).toBe(r.calls); expect(r.status).not.toBe('registered'); }
    if (r.kind === 'late') expect(r).toMatchObject({ before: 'unavailable', after: 'registered', registered: 25, removed: 25 });
    if (r.kind === 'unsupported') expect(r).toMatchObject({ status: 'registered', legacy: 25 });
  }
});
test('native availability is measured separately from injected compatibility', async ({ page, browser, browserName }, info) => {
  await page.goto('/');
  const probe = await page.evaluate(async () => {
    const describe = root => { try { const value = root.modelContext; return { present: Boolean(value), registerTool: typeof value?.registerTool, provideContext: typeof value?.provideContext }; } catch (e) { return { error: String(e) }; } };
    return { document: describe(document), navigator: describe(navigator), registration: await window.tanglePages.webmcp.ready, secure: isSecureContext, origin: location.origin };
  });
  await expect(page.locator('.hero h1')).toBeVisible();
  await info.attach('native-webmcp', { contentType: 'application/json', body: JSON.stringify({ browserName, version: browser.version(), flags: 'stock Playwright; no origin trial or experimental WebMCP flags', ...probe }, null, 2) });
  if (!probe.document.present && !probe.navigator.present) expect(probe.registration.status).toBe('unavailable');
});

test('two visual assistant hosts retain independent drafts, focus and request cleanup', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.assistants = ['Research desk', 'Workshop'].map(title => {
      const node = document.createElement('div'); document.body.append(node);
      return window.hostApi.mountAssistant(node, { title, open: true, capabilities: [title + ' tools'],
        settings: { provider: 'custom', baseUrl: 'https://fixture.invalid/v1', model: title, apiKey: '' },
        aiFetch: (_url, init) => { window.assistantSignal = init.signal; return new Promise(resolve => { window.releaseAssistant = resolve; }); },
      });
    });
    document.querySelectorAll('.ai-panel').forEach((panel, index) => { panel.style.position = 'relative'; panel.style.inset = 'auto'; panel.parentElement.id = 'fixture-assistant-' + index; });
  });
  const first = page.locator('#fixture-assistant-0'), second = page.locator('#fixture-assistant-1');
  await first.locator('.ai-composer textarea').fill('Keep this draft');
  await first.locator('.ai-composer textarea').evaluate(node => { node.focus(); node.setSelectionRange(4, 7); window.originalComposer = node; });
  await page.evaluate(() => window.assistants[0].update({ title: 'Updated research desk' }));
  expect(await first.locator('.ai-composer textarea').evaluate(node => ({ same: node === window.originalComposer, focus: node === document.activeElement, start: node.selectionStart, end: node.selectionEnd }))).toEqual({ same: true, focus: true, start: 4, end: 7 });
  await expect(second.locator('.ai-composer textarea')).toHaveValue('');
  await first.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.assistantSignal.aborted)).toBe(true);
  await page.evaluate(async () => { await window.assistants[0].dispose(); await window.assistants[0].dispose(); });
  await expect(first).toHaveCount(0); await expect(second).toBeVisible();
  await page.evaluate(() => window.assistants[1].dispose());
});

test('assistant Markdown uses native page-break screen and print styles without interpreting code markers', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const node = document.createElement('div'); node.id = 'page-break-assistant'; document.body.append(node);
    window.pageBreakAssistant = window.hostApi.mountAssistant(node, {
      open: true, transcript: { messages: [{ role: 'assistant', content:
        'First page\n<!-- pagebreak -->\nSecond page\n\n```md\n<!-- pagebreak -->\n```\n\nInline <!-- pagebreak --> marker.' }] },
    });
  });
  const host = page.locator('#page-break-assistant');
  const separator = host.getByRole('separator', { name: 'Page break' });
  await expect(separator).toHaveCount(1);
  await expect(separator).toHaveCSS('border-top-style', 'dashed');
  await expect(host.locator('pre')).toContainText('<!-- pagebreak -->');
  await expect(host).toContainText('Second page');
  await page.emulateMedia({ media: 'print' });
  await expect(separator).toHaveCSS('break-after', 'page');
  await expect(separator).toHaveCSS('border-top-width', '0px');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.pageBreakAssistant.dispose());
  await expect(host).toBeEmpty();
});
