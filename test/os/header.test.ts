/**
 * Header bars of @tangleai/os: an application describes its title-bar items
 * as a bounded document, the kernel holds it per window, and every use (the
 * person's through the shell, the assistant's through its tools) takes one
 * checked path into the ledger and reaches the application over its own
 * channel, framed or shipped.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, systemContracts, activateHeader, duplicateHeaderId, fitHeader, headerFor, CONNECT, HELLO, PROTOCOL, type Header } from '@tangleai/os';
import { connectToOs } from '@tangleai/os/module';
import { openPortClient } from '@jarenjs/contract/port';
import * as toolbox from '@tangleai/agents/toolbox';

const HEADER: Header = {
  start: [{ kind: 'button', id: 'prev', label: 'Previous month', glyph: 'back' }, { kind: 'toggle', id: 'sidebar', label: 'Sidebar', glyph: 'sidebar', pressed: false }],
  center: { kind: 'tabs', id: 'view', label: 'View', selected: 'month', items: [{ id: 'month', label: 'Month' }, { id: 'week', label: 'Week' }, { id: 'day', label: 'Day', disabled: true }] },
  end: [
    { kind: 'search', id: 'find', label: 'Search events' },
    { kind: 'menu', id: 'more', label: 'More', entries: [{ id: 'export', label: 'Export…', shortcut: 'Ctrl+E' }, { separator: true }, { id: 'wipe', label: 'Delete all', assistant: false }] },
  ],
  subtitle: 'November 2026',
};
const app = (id: string) => ({ $module: '0.1', id, version: '1.0.0', title: { en: id }, host: { kind: 'shipped', mount: id } });

describe('the header document', () => {
  it('keeps every id once, tabs and menu entries included', () => {
    assert.equal(duplicateHeaderId(HEADER), null);
    assert.equal(duplicateHeaderId({ ...HEADER, start: [{ kind: 'button', id: 'week', label: 'Week' }] }), 'week');
  });
  it('checks each kind of use and keeps the state the desktop shows', () => {
    const toggled = activateHeader(HEADER, 'shell', 'sidebar', undefined);
    assert.ok(toggled.ok && toggled.value === true && (toggled.header.start![1] as any).pressed === true, 'a toggle without a value flips');
    const tab = activateHeader(HEADER, 'shell', 'view', 'week');
    assert.ok(tab.ok && (tab.header.center as any).selected === 'week');
    const typed = activateHeader(HEADER, 'shell', 'find', 'dentist');
    assert.ok(typed.ok && (typed.header.end![0] as any).value === 'dentist');
    assert.deepEqual(activateHeader(HEADER, 'shell', 'more', 'export'), { ok: true, header: HEADER, value: 'export' });
    const refused = (item: string, value: unknown, caller = 'shell') => { const r = activateHeader(HEADER, caller, item, value); return r.ok ? 'ok' : r.code; };
    assert.equal(refused('nothing', undefined), 'OS0114');
    assert.equal(refused('view', 'day'), 'OS0115', 'a disabled tab');
    assert.equal(refused('view', 'year'), 'OS0116');
    assert.equal(refused('prev', 'x'), 'OS0116', 'a button takes no value');
    assert.equal(refused('sidebar', 'yes'), 'OS0116');
    assert.equal(refused('more', 'wipe'), 'ok', 'the person may use what is kept from the assistant');
    assert.equal(refused('more', 'wipe', 'assistant'), 'OS0115');
  });
  it('keeps from the assistant what the application says is not its to use', () => {
    const seen = headerFor({ ...HEADER, start: [{ kind: 'button', id: 'prev', label: 'Previous', assistant: false }] }, 'assistant');
    assert.equal(seen.start, undefined);
    assert.deepEqual((seen.end![1] as any).entries.map((e: any) => e.id ?? 'separator'), ['export', 'separator']);
    assert.deepEqual(headerFor(HEADER, 'shell'), HEADER);
  });
  it('fits as many droppable items as there is room for beside "more"', () => {
    assert.equal(fitHeader([30, 30, 30], 90, 32), 3, 'all fit: no "more"');
    assert.equal(fitHeader([30, 30, 30], 89, 32), 1);
    assert.equal(fitHeader([30, 30, 30], 20, 32), 0);
    assert.equal(fitHeader([], 0, 32), 0);
  });
});

describe('header bars in the kernel', () => {
  it('holds a header per window, refuses a bad one and one set over another module', () => {
    const kernel = createKernel();
    const events: any[] = [];
    kernel.subscribe(e => { if (e.kind === 'header') events.push(e); });
    assert.equal(kernel.setHeader('cal', 'w1', HEADER).ok, true);
    assert.equal(kernel.header('w1')!.subtitle, 'November 2026');
    const bad = kernel.setHeader('cal', 'w1', { start: [{ kind: 'button', id: 'x', label: 'X', glyph: '<svg onload=alert(1)>' }] });
    assert.ok(!bad.ok && bad.error.code === 'OS0113', 'a glyph outside the desktop set');
    const twice = kernel.setHeader('cal', 'w1', { start: [{ kind: 'button', id: 'x', label: 'X' }, { kind: 'button', id: 'x', label: 'Y' }] });
    assert.ok(!twice.ok && /used twice/.test(twice.error.message));
    const tooMany = kernel.setHeader('cal', 'w1', { start: Array.from({ length: 5 }, (_, i) => ({ kind: 'button', id: `b${i}`, label: 'B' })) });
    assert.ok(!tooMany.ok, 'at most four items a row');
    assert.equal(kernel.setHeader('other', 'w1', HEADER).ok, false, 'the window belongs to the module that set it');
    assert.equal(kernel.setHeader('cal', 'w1', null).ok, true);
    assert.equal(kernel.header('w1'), undefined);
    assert.deepEqual(events.map(e => e.window), ['w1', 'w1']);
  });

  it('takes the person and the assistant down one checked path into the ledger and to the application', async () => {
    const kernel = createKernel({ assistantGrants: ['tangle_os_header.*'] });
    kernel.setHeader('cal', 'w1', HEADER);
    const used: any[] = [];
    const early = await kernel.call('shell', 'tangle_os_header', 'header.activate', { window: 'w1', item: 'prev' });
    assert.ok(!early.ok && early.error.code === 'OS0117', 'not connected: nothing takes it');
    const release = kernel.registerHeaderHandler('cal', 'w1', (a) => { used.push(a); return a.item === 'more' && a.value === 'export' ? { refused: 'nothing to export' } : undefined; });

    assert.equal((await kernel.call('shell', 'tangle_os_header', 'header.activate', { window: 'w1', item: 'prev' })).ok, true);
    assert.equal((await kernel.call('assistant', 'tangle_os_header', 'header.activate', { window: 'w1', item: 'view', value: 'week' })).ok, true);
    assert.equal((kernel.header('w1')!.center as any).selected, 'week', 'the desktop keeps the chosen tab');
    const refused = await kernel.call('assistant', 'tangle_os_header', 'header.activate', { window: 'w1', item: 'more', value: 'export' });
    assert.ok(!refused.ok && refused.error.code === 'OS0118' && refused.error.message === 'nothing to export');
    const kept = await kernel.call('assistant', 'tangle_os_header', 'header.activate', { window: 'w1', item: 'more', value: 'wipe' });
    assert.ok(!kept.ok && kept.error.code === 'OS0115');
    const shaped = await kernel.call('assistant', 'tangle_os_header', 'header.activate', { window: 'w1' });
    assert.equal(shaped.ok, false, 'the contract checks the input');
    assert.deepEqual(used, [{ item: 'prev', by: 'person' }, { item: 'view', value: 'week', by: 'assistant' }, { item: 'more', value: 'export', by: 'assistant' }]);

    const listed: any = await kernel.call('assistant', 'tangle_os_header', 'header.list', {});
    assert.ok(listed.ok);
    assert.deepEqual(listed.value.windows.map((w: any) => [w.window, w.module]), [['w1', 'cal']]);
    assert.ok(!JSON.stringify(listed.value).includes('wipe'), 'the list keeps from the assistant what it may not use');

    const stranger = await kernel.call('records-app', 'tangle_os_header', 'header.activate', { window: 'w1', item: 'prev' });
    assert.ok(!stranger.ok && stranger.error.code === 'OS0101', 'a module needs a grant');
    assert.deepEqual(kernel.ledger().filter(l => l.contract === 'tangle_os_header').map(l => [l.caller, l.op, l.ok]), [
      ['shell', 'header.activate', false], ['shell', 'header.activate', true], ['assistant', 'header.activate', true], ['assistant', 'header.activate', false],
      ['assistant', 'header.activate', false], ['assistant', 'header.activate', false], ['assistant', 'header.list', true], ['records-app', 'header.activate', false],
    ]);
    release();
    assert.equal(kernel.hasHeaderHandler('w1'), false);
  });

  it('offers the header to the assistant as tools only under its grants', async () => {
    const none = createKernel({ tools: toolbox });
    assert.deepEqual(none.operations().map(o => o.tool), []);
    const kernel = createKernel({ assistantGrants: 'all', tools: toolbox });
    kernel.install(app('cal'), 'shipped');
    kernel.setHeader('cal', 'w1', HEADER);
    const used: any[] = [];
    kernel.registerHeaderHandler('cal', 'w1', (a) => { used.push(a); });
    assert.deepEqual(kernel.operations().map(o => o.tool), ['tangle_os_header__header_list', 'tangle_os_header__header_activate', 'tangle_os_dock__dock_read', 'tangle_os_dock__dock_suggest', 'tangle_os_files__files_locations', 'tangle_os_files__files_list', 'tangle_os_files__files_search', 'tangle_os_files__files_read', 'tangle_os_apps__apps_crib', 'tangle_os_apps__apps_check', 'tangle_os_apps__apps_read', 'tangle_os_apps__apps_revise', 'tangle_os_apps__apps_suggest']);
    const tools: any = kernel.tools();
    const names = tools.toFunctionTools().map((t: any) => t.function.name);
    assert.deepEqual(names, ['tangle_os_header__header_list', 'tangle_os_header__header_activate', 'tangle_os_dock__dock_read', 'tangle_os_dock__dock_suggest', 'tangle_os_files__files_locations', 'tangle_os_files__files_list', 'tangle_os_files__files_search', 'tangle_os_files__files_read', 'tangle_os_apps__apps_crib', 'tangle_os_apps__apps_check', 'tangle_os_apps__apps_read', 'tangle_os_apps__apps_revise', 'tangle_os_apps__apps_suggest']);
    await tools.execute('tangle_os_header__header_activate', { window: 'w1', item: 'sidebar', value: true });
    assert.deepEqual(used, [{ item: 'sidebar', value: true, by: 'assistant' }]);
  });
});

describe('header bars from a framed page', () => {
  it('sets its header over its own port and hears uses on its control channel', async () => {
    const listeners = new Set<(event: any) => void>();
    const parent = { postMessage: () => {} };
    const host = { parent, document: { documentElement: null }, addEventListener: (_: string, l: any) => listeners.add(l), removeEventListener: (_: string, l: any) => listeners.delete(l) };
    const heard: any[] = [];
    const kernel = createKernel();
    kernel.install({ ...app('cal'), host: { kind: 'origin', url: 'https://cal.example/' } }, 'suite');
    const joined = connectToOs({ origins: ['https://desk.example'], host, presentation: 'none', onHeader: (a) => { heard.push(a); return a.item === 'prev' ? undefined : { refused: 'not now' }; } });
    const os = new MessageChannel(), control = new MessageChannel();
    try {
      kernel.serveModule('cal', os.port1, { window: 'w7' }); os.port1.start();
      const moduleClient: any = openPortClient(systemContracts().module, { channel: control.port1, timeoutMs: 5000 }); control.port1.start();
      kernel.registerHeaderHandler('cal', 'w7', async (a) => { const outcome = await moduleClient.invoke('module.header', a); return outcome.ok ? outcome.value : outcome; });
      for (const l of [...listeners]) l({ source: parent, origin: 'https://desk.example', data: { type: CONNECT, protocol: PROTOCOL, module: 'cal', ports: ['os', 'module'], theme: { tokens: {}, scheme: 'light' }, locale: { locale: 'en', dir: 'ltr' } }, ports: [os.port2, control.port2] });
      const connection = await joined;
      await connection.setHeader(HEADER);
      assert.equal(kernel.header('w7')!.subtitle, 'November 2026', 'the header lands on the window the port belongs to');
      await assert.rejects(connection.setHeader({ start: [{ kind: 'nothing' }] } as any), 'a header the contract refuses');
      await assert.rejects(connection.setHeader({ start: [{ kind: 'button', id: 'x', label: 'X' }, { kind: 'button', id: 'x', label: 'Y' }] }), (error: any) => error.code === 'OS0113' && /used twice/.test(error.message), 'a refusal keeps its code and reason');
      assert.equal((await kernel.call('shell', 'tangle_os_header', 'header.activate', { window: 'w7', item: 'prev' })).ok, true);
      const refused = await kernel.call('shell', 'tangle_os_header', 'header.activate', { window: 'w7', item: 'view', value: 'week' });
      assert.ok(!refused.ok && refused.error.code === 'OS0118' && refused.error.message === 'not now');
      assert.deepEqual(heard, [{ item: 'prev', by: 'person' }, { item: 'view', value: 'week', by: 'person' }]);
      await connection.setHeader(null);
      assert.equal(kernel.header('w7'), undefined);
      connection.close();
    } finally { os.port1.close(); control.port1.close(); }
    assert.equal(HELLO.length > 0, true);
  });
});
