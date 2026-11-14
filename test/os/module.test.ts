/**
 * The module side of @tangleai/os and the desktop's pure state: a framed
 * page joins only its own parent from an allowed origin, serves its contracts
 * and the control contract on the ports it is handed, and applies the theme
 * and language; window state and theme documents behave headless.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectToOs } from '@tangleai/os/module';
import {
  CONNECT, HELLO, PROTOCOL, createKernel, systemContracts, checkTheme, DEFAULT_THEMES,
  emptyDesktop, openWindow, focusWindow, closeWindow, moveWindow, resizeWindow, toggleMaximize, minimizeWindow, setViewport, stacked,
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
