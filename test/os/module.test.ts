/**
 * The module side of @tangleai/os and the desktop's pure state: a framed
 * page joins only its own parent from an allowed origin, serves its contracts
 * and the control contract on the ports it is handed, and applies the theme
 * and language; window state and theme documents behave headless.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectToOs, OsConnectError } from '@tangleai/os/module';
import {
  CONNECT, HELLO, PROTOCOL, createKernel, systemContracts, checkTheme, DEFAULT_THEMES,
  emptyDesktop, openWindow, focusWindow, closeWindow, moveWindow, resizeWindow, toggleMaximize, minimizeWindow, setViewport, resizeDesktop, isVisible, stacked,
} from '@tangleai/os';
import { openPortClient } from '@jarenjs/contract/port';

const RECORDS = { $contract: '0.1', id: 'records', operations: { 'records.search': { kind: 'read', input: { type: 'object', properties: { query: { type: 'string' } } }, output: { type: 'array' } } } };

/** A page in a frame: its own parent, a style root, and the message listeners the shell posts to. */
function framedPage() {
  const listeners = new Set<(event: any) => void>();
  const posted: any[] = [];
  const parent = { postMessage: (message: any) => posted.push(message) };
  const style = new Map<string, string>();
  const attributes = new Map<string, string>();
  const root = { style: { setProperty: (k: string, v: string) => style.set(k, v), colorScheme: '' }, dataset: {} as any, setAttribute: (k: string, v: string) => attributes.set(k, v) };
  const host = {
    parent,
    document: { documentElement: root },
    addEventListener: (_: string, l: any) => listeners.add(l),
    removeEventListener: (_: string, l: any) => listeners.delete(l),
  };
  const deliver = (event: any) => { for (const l of [...listeners]) l(event); };
  return { host, posted, style, attributes, root, deliver, listeners };
}

function connectMessage(module: string, ports: string[]) {
  return { type: CONNECT, protocol: PROTOCOL, module, ports, theme: { tokens: { '--accent': '#ff0066', 'bad name': 'x' }, scheme: 'dark' as const }, locale: { locale: 'ar', dir: 'rtl' as const } };
}

describe('joining a desktop from a framed page', () => {
  it('announces itself, ignores foreign windows and origins, then serves its contract and applies theme and language', async () => {
    const page = framedPage();
    const kernel = createKernel();
    kernel.install({ $module: '0.1', id: 'records-app', version: '1.0.0', title: { en: 'Records' }, host: { kind: 'origin', url: 'https://records.example/app' }, provides: [RECORDS] }, 'suite');
    const joined = connectToOs({
      origins: ['https://desk.example'], host: page.host,
      serve: [{ contract: RECORDS, handlers: { 'records.search': ({ query }: any) => [{ name: `found ${query}` }] } }],
      context: () => ({ showing: 'search' }),
    });
    assert.deepEqual(page.posted, [{ type: HELLO, protocol: PROTOCOL }]);

    const os = new MessageChannel(), control = new MessageChannel(), records = new MessageChannel();
    try {
      page.deliver({ source: {}, origin: 'https://desk.example', data: connectMessage('records-app', ['os', 'module', 'records']), ports: [] });
      page.deliver({ source: page.host.parent, origin: 'https://evil.example', data: connectMessage('records-app', ['os', 'module', 'records']), ports: [] });
      assert.equal(page.listeners.size, 1, 'neither a foreign window nor a foreign origin is accepted');

      kernel.serveModule('records-app', os.port1); os.port1.start();
      kernel.connectProvider('records-app', RECORDS, records.port1);
      const moduleClient: any = openPortClient(systemContracts().module, { channel: control.port1, timeoutMs: 5000 }); control.port1.start();
      page.deliver({ source: page.host.parent, origin: 'https://desk.example', data: connectMessage('records-app', ['os', 'module', 'records']), ports: [os.port2, control.port2, records.port2] });
      const connection = await joined;
      assert.equal(connection.module, 'records-app');
      assert.equal(page.style.get('--accent'), '#ff0066');
      assert.equal(page.style.has('bad name'), false, 'only custom property names are set');
      assert.equal(page.root.style.colorScheme, 'dark');
      assert.deepEqual([page.attributes.get('lang'), page.attributes.get('dir')], ['ar', 'rtl']);

      const found = await kernel.call('shell', 'records', 'records.search', { query: 'oak' });
      assert.deepEqual(found, { ok: true, value: [{ name: 'found oak' }] });
      const context = await moduleClient.invoke('module.context', {});
      assert.deepEqual(context.value, { showing: 'search' });
      await moduleClient.invoke('module.theme', { tokens: { '--accent': '#00aa88' }, scheme: 'light' });
      assert.equal(page.style.get('--accent'), '#00aa88');
      const mail = await connection.sendMail({ subject: 'Ready' });
      assert.equal(mail.ok, true);
      assert.deepEqual(kernel.mail().map(m => [m.from, m.subject]), [['records-app', 'Ready']]);
      connection.close();
    } finally { for (const c of [os, control, records]) { c.port1.close(); c.port2.close(); } }
  });
});

describe('a connection that never happens', () => {
  it('refuses an unanswered handshake at its deadline and stops listening', async () => {
    const page = framedPage();
    const started = Date.now();
    await assert.rejects(connectToOs({ origins: ['https://desk.example'], host: page.host, connectTimeoutMs: 1 }), (error: any) => error instanceof OsConnectError && error.code === 'OS0401');
    assert.ok(Date.now() - started < 1000);
    assert.equal(page.listeners.size, 0, 'no listener is left behind');
  });
  it('refuses an abandoned handshake, before or while it waits, and stops listening', async () => {
    const page = framedPage(), controller = new AbortController();
    const pending = connectToOs({ origins: ['https://desk.example'], host: page.host, signal: controller.signal });
    assert.equal(page.listeners.size, 1);
    controller.abort(new Error('the person left'));
    await assert.rejects(pending, (error: any) => error.code === 'OS0403' && error.cause?.message === 'the person left');
    assert.equal(page.listeners.size, 0);
    await assert.rejects(connectToOs({ origins: ['https://desk.example'], host: framedPage().host, signal: AbortSignal.abort() }), (error: any) => error.code === 'OS0403');
  });
  it('refuses at once when the page is not framed by a desktop', async () => {
    const top: any = { addEventListener() { throw new Error('never listens'); }, removeEventListener() {} };
    top.parent = top;
    await assert.rejects(connectToOs({ origins: ['https://desk.example'], host: top }), (error: any) => error.code === 'OS0402');
  });
  it("keeps the application's own look when it asks to, and still hears the theme and language", async () => {
    for (const presentation of ['none', 'own'] as const) {
      const page = framedPage(), heard: any[] = [];
      const own = { style: { setProperty: () => heard.push('own-style'), colorScheme: '' }, dataset: {} as any, setAttribute: () => heard.push('own-attr') };
      const kernel = createKernel();
      kernel.install({ $module: '0.1', id: 'records-app', version: '1.0.0', title: { en: 'Records' }, host: { kind: 'origin', url: 'https://records.example/app' } }, 'suite');
      const joined = connectToOs({ origins: ['https://desk.example'], host: page.host, presentation: presentation === 'none' ? 'none' : { root: own }, onTheme: () => heard.push('theme'), onLocale: () => heard.push('locale') });
      const os = new MessageChannel(), control = new MessageChannel();
      try {
        kernel.serveModule('records-app', os.port1); os.port1.start();
        page.deliver({ source: page.host.parent, origin: 'https://desk.example', data: connectMessage('records-app', ['os', 'module']), ports: [os.port2, control.port2] });
        (await joined).close();
        assert.equal(page.style.size, 0, `${presentation}: the page's root is untouched`);
        assert.equal(page.attributes.size, 0);
        assert.deepEqual(heard.filter(h => h === 'theme' || h === 'locale'), ['theme', 'locale']);
        assert.equal(heard.includes('own-style'), presentation === 'own', 'an own target gets the tokens');
      } finally { for (const c of [os, control]) { c.port1.close(); c.port2.close(); } }
    }
  });
});

describe('the window document', () => {
  it('opens, cascades, focuses, stacks and closes', () => {
    let d = emptyDesktop({ w: 1200, h: 800 });
    d = openWindow(d, { module: 'a', title: 'A' });
    d = openWindow(d, { module: 'b', title: 'B' });
    assert.deepEqual(stacked(d).map(w => w.module), ['a', 'b']);
    assert.equal(d.focus, 'w2');
    assert.notDeepEqual(d.windows[0].rect, d.windows[1].rect, 'new windows cascade');
    d = focusWindow(d, 'w1');
    assert.deepEqual(stacked(d).map(w => w.module), ['b', 'a']);
    d = closeWindow(d, 'w1');
    assert.equal(d.focus, 'w2');
  });
  it('keeps a single-instance module to one window', () => {
    let d = emptyDesktop();
    d = openWindow(d, { module: 'mail', title: 'Mail', singleton: true });
    d = minimizeWindow(d, 'w1');
    d = openWindow(d, { module: 'mail', title: 'Mail', singleton: true });
    assert.equal(d.windows.length, 1);
    assert.equal(d.windows[0].minimized, false);
  });
  it('keeps a grabbable title bar on screen and respects minimum sizes', () => {
    let d = openWindow(emptyDesktop({ w: 1000, h: 700 }), { module: 'a', title: 'A', width: 400, height: 300 });
    d = moveWindow(d, 'w1', -5000, -300);
    assert.ok(d.windows[0].rect.x + d.windows[0].rect.w >= 48 && d.windows[0].rect.y === 0);
    d = resizeWindow(d, 'w1', 10, 10);
    assert.deepEqual([d.windows[0].rect.w, d.windows[0].rect.h], [200, 120]);
  });
  it('maximizes to the viewport and restores, and follows a new viewport', () => {
    let d = openWindow(emptyDesktop({ w: 1000, h: 700 }), { module: 'a', title: 'A', width: 400, height: 300 });
    const original = d.windows[0].rect;
    d = toggleMaximize(d, 'w1');
    assert.deepEqual(d.windows[0].rect, { x: 0, y: 0, w: 1000, h: 700 });
    d = setViewport(d, { w: 1400, h: 900 });
    assert.deepEqual(d.windows[0].rect, { x: 0, y: 0, w: 1400, h: 900 });
    d = toggleMaximize(d, 'w1');
    assert.deepEqual(d.windows[0].rect, original);
  });
  it('opens a window wholly on a desktop narrower than it, and resizes it no smaller than its manifest says', () => {
    // an 840 px window on a 390 px phone used to cascade to x = -309
    let d = openWindow(emptyDesktop({ w: 390, h: 768 }), { module: 'a', title: 'A', width: 840, height: 600, minWidth: 320, minHeight: 240 });
    assert.deepEqual(d.windows[0].rect, { x: 0, y: 24, w: 390, h: 600 });
    d = openWindow(emptyDesktop({ w: 1000, h: 700 }), { module: 'b', title: 'B', width: 500, height: 400, minWidth: 320, minHeight: 240 });
    const r = d.windows[0].rect;
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1000 && r.y + r.h <= 700, JSON.stringify(r));
    d = resizeWindow(d, 'w1', 10, 10);
    assert.deepEqual([d.windows[0].rect.w, d.windows[0].rect.h], [320, 240], "the resize grip keeps the manifest's minimum");
    d = setViewport(d, { w: 900, h: 600 });
    assert.deepEqual([d.windows[0].rect.w, d.windows[0].rect.h], [320, 240]);
  });
  it('on a compact desktop opens every window maximized, shows only the focused one, and restores on leaving', () => {
    let d = openWindow(emptyDesktop({ w: 1000, h: 700 }), { module: 'a', title: 'A', width: 400, height: 300 });
    d = toggleMaximize(openWindow(d, { module: 'b', title: 'B', width: 400, height: 300 }), 'w2');
    const before = d.windows[0].rect;
    d = resizeDesktop(d, { w: 390, h: 768 }, true);
    assert.deepEqual(d.windows.map(w => [w.maximized, w.compacted ?? false]), [[true, true], [true, false]]);
    d = openWindow(d, { module: 'c', title: 'C' });
    assert.deepEqual(d.windows[2].rect, { x: 0, y: 0, w: 390, h: 768 }, 'a new window opens maximized');
    assert.deepEqual(d.windows.map(w => isVisible(d, w)), [false, false, true], 'only the focused window is shown');
    d = toggleMaximize(d, 'w3');
    assert.equal(d.windows[2].maximized, true, 'a compact desktop has no restore');
    d = focusWindow(d, 'w1');
    assert.deepEqual(d.windows.map(w => isVisible(d, w)), [true, false, false]);
    d = resizeDesktop(d, { w: 1000, h: 700 }, false);
    assert.deepEqual(d.windows.map(w => w.maximized), [false, true, false], "the person's own maximize stays");
    assert.deepEqual(d.windows[0].rect, before, 'a window the desktop maximized gets its place back');
    assert.deepEqual(d.windows.map(w => isVisible(d, w)), [true, true, true]);
  });
});

describe('theme documents', () => {
  it('accepts the shipped themes', () => {
    assert.deepEqual(checkTheme(DEFAULT_THEMES.light), []);
    assert.deepEqual(checkTheme(DEFAULT_THEMES.dark), []);
  });
  it('refuses values that import, script or load from another origin', () => {
    const bad = { ...DEFAULT_THEMES.light, tokens: {
      '--a': 'url(https://tracker.example/p.png)', '--b': 'expression(alert(1))', '--c': 'javascript:alert(1)', '--d': '@import "x.css"',
      '--ok': 'url("data:image/png;base64,iVBORw0KGgo=")', 'color': 'red',
    } };
    const problems = checkTheme(bad as any);
    assert.deepEqual(problems.map(p => p.split(':')[0]).sort(), ['--a', '--b', '--c', '--d', 'color']);
  });
});
