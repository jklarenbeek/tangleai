/**
 * The kernel of @tangleai/os: manifests, layers with a journal and a
 * recovery boot, and the contract bus under grants with its ledger, driven
 * over real MessageChannel ports as a framed module would be.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, validateManifest, systemContracts } from '@tangleai/os';
import { openPortClient, servePort } from '@jarenjs/contract/port';
import { compileContract } from '@jarenjs/contract';
import * as toolbox from '@tangleai/agents/toolbox';

const RECORDS = {
  $contract: '0.1', id: 'records',
  operations: {
    'records.search': { kind: 'read', input: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }, output: { type: 'array' } },
    'records.get': { kind: 'read', input: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, output: { type: 'object' } },
  },
};
const ROWS = [{ id: 'r1', name: 'Oak table' }, { id: 'r2', name: 'Pine chair' }];
const manifest = (id: string, extra: object = {}) => ({ $module: '0.1', id, version: '1.0.0', title: { en: id }, host: { kind: 'shipped', mount: id }, ...extra });

describe('module manifests', () => {
  it('accepts the three host kinds', () => {
    for (const host of [{ kind: 'shipped', mount: 'about' }, { kind: 'document', app: { $app: '0.1', state: {}, view: [] } }, { kind: 'origin', url: 'https://suite.example/records' }]) {
      const verdict = validateManifest({ ...manifest('a'), host });
      assert.equal(verdict.ok, true, JSON.stringify(verdict));
    }
  });
  it('refuses with a code and a pointer', () => {
    const cases: [object, string, string][] = [
      [{ ...manifest('a'), host: { kind: 'remote' } }, 'OS0002', '/host/kind'],
      [{ ...manifest('Bad Id') }, 'OS0001', '/id'],
      [{ ...manifest('a'), title: { nl: 'Alleen Nederlands' } }, 'OS0001', '/title'],
      [{ ...manifest('a'), script: 'alert(1)' }, 'OS0001', '/script'],
      [{ ...manifest('a'), provides: [RECORDS, RECORDS] }, 'OS0003', '/provides/1/id'],
    ];
    for (const [value, code, path] of cases) {
      const verdict = validateManifest(value);
      assert.equal(verdict.ok, false);
      assert.ok(!verdict.ok && verdict.issues.some(i => i.code === code && i.path === path), `${code} at ${path}: ${JSON.stringify(verdict)}`);
    }
  });
  it('freezes what it accepts', () => {
    const verdict = validateManifest(manifest('a'));
    assert.ok(verdict.ok && Object.isFrozen(verdict.manifest));
  });
});

describe('layers, journal and recovery', () => {
  it('patches a shipped module in the user layer, undoes it, and never writes the shipped document', () => {
    const kernel = createKernel();
    const shipped = manifest('notes', { window: { width: 600 } });
    const before = JSON.stringify(shipped);
    kernel.install(shipped, 'shipped');
    const patched = kernel.patch('notes', [{ op: 'replace', path: '/title/en', value: 'My notes' }, { op: 'replace', path: '/window/width', value: 720 }]);
    assert.equal(patched.ok, true);
    assert.equal(kernel.effective('notes')!.title.en, 'My notes');
    assert.equal(kernel.effective('notes')!.window!.width, 720);
    const entry = kernel.journal().at(-1)!;
    assert.equal(entry.kind, 'patch');
    assert.deepEqual(entry.inverse, [{ op: 'replace', path: '/title/en', value: 'notes' }, { op: 'replace', path: '/window/width', value: 600 }]);
    assert.equal(kernel.undo().ok, true);
    assert.equal(kernel.effective('notes')!.title.en, 'notes');
    assert.equal(JSON.stringify(shipped), before);
  });
  it('refuses a patch that would make the module invalid or change its id, and changes nothing', () => {
    const kernel = createKernel();
    kernel.install(manifest('notes'), 'shipped');
    const bad = kernel.patch('notes', [{ op: 'add', path: '/script', value: 'x' }]);
    assert.equal(bad.ok, false); assert.equal(!bad.ok && bad.error.code, 'OS0007');
    const renamed = kernel.patch('notes', [{ op: 'replace', path: '/id', value: 'other' }]);
    assert.equal(!renamed.ok && renamed.error.code, 'OS0008');
    assert.equal(kernel.journal().length, 0);
  });
  it('boots in recovery without the user layer', () => {
    const shipped = manifest('notes');
    const mine = manifest('mine', { host: { kind: 'document', app: { $app: '0.1', state: {}, view: [] } } });
    const normal = createKernel(), safe = createKernel({ recovery: true });
    for (const kernel of [normal, safe]) {
      kernel.install(shipped, 'shipped');
      kernel.install(mine, 'user');
      kernel.patch('notes', [{ op: 'replace', path: '/title/en', value: 'Broken' }]);
    }
    assert.deepEqual(normal.modules().map(m => m.id), ['notes', 'mine']);
    assert.equal(normal.effective('notes')!.title.en, 'Broken');
    assert.deepEqual(safe.modules().map(m => m.id), ['notes']);
    assert.equal(safe.effective('notes')!.title.en, 'notes');
  });
  it('removes and restores a module a person installed; a shipped one is not removable', () => {
    const kernel = createKernel();
    kernel.install(manifest('notes'), 'shipped');
    kernel.install(manifest('mine'), 'user');
    assert.equal(!kernel.remove('notes').ok && (kernel.remove('notes') as any).error.code, 'OS0009');
    assert.equal(kernel.remove('mine').ok, true);
    assert.equal(kernel.effective('mine'), null);
    kernel.undo();
    assert.equal(kernel.effective('mine')!.id, 'mine');
  });
});

describe('the contract bus', () => {
  /** A provider module serving `records` on a real port, as a framed module does. */
  function provider(kernel: ReturnType<typeof createKernel>) {
    const channel = new MessageChannel();
    servePort(compileContract(RECORDS as any), {
      'records.search': ({ query }: any) => ROWS.filter(r => r.name.toLowerCase().includes(query.toLowerCase())),
      'records.get': ({ id }: any) => ROWS.find(r => r.id === id) ?? {},
    }, { channel: channel.port2 });
    channel.port2.start();
    kernel.connectProvider('records-app', RECORDS, channel.port1);
    return channel;
  }

  it('routes a granted call, refuses an ungranted one, and writes both to the ledger', async () => {
    const kernel = createKernel({ now: () => 1000 });
    kernel.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
    kernel.install(manifest('labels', { requires: [{ contract: 'records', operations: ['records.search'] }] }), 'suite');
    kernel.install(manifest('mine', { host: { kind: 'document', app: { $app: '0.1', state: {}, view: [] } } }), 'user');
    const channel = provider(kernel);
    try {
      const granted = await kernel.call('labels', 'records', 'records.search', { query: 'oak' });
      assert.deepEqual(granted, { ok: true, value: [{ id: 'r1', name: 'Oak table' }] });
      const notGranted = await kernel.call('labels', 'records', 'records.get', { id: 'r1' });
      assert.equal(!notGranted.ok && notGranted.error.code, 'OS0101');
      const userModule = await kernel.call('mine', 'records', 'records.search', { query: '' });
      assert.equal(!userModule.ok && userModule.error.code, 'OS0101', 'a module a person made asks first');
      kernel.grant('mine', 'records.*');
      assert.equal((await kernel.call('mine', 'records', 'records.get', { id: 'r2' })).ok, true);
      const missing = await kernel.call('labels', 'nothing', 'x');
      assert.equal(!missing.ok && missing.error.code, 'OS0102');
      assert.deepEqual(kernel.ledger().map(e => [e.caller, e.op, e.ok, e.code ?? null]), [
        ['labels', 'records.search', true, null],
        ['labels', 'records.get', false, 'OS0101'],
        ['mine', 'records.search', false, 'OS0101'],
        ['mine', 'records.get', true, null],
        ['labels', 'x', false, 'OS0102'],
      ]);
    } finally { channel.port1.close(); channel.port2.close(); }
  });

  it('serves tangle_os to a module over its own port: calls, mail and title carry the port\'s identity', async () => {
    const kernel = createKernel();
    kernel.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
    kernel.install(manifest('labels', { requires: [{ contract: 'records' }] }), 'suite');
    const records = provider(kernel);
    const osChannel = new MessageChannel();
    const titles: string[] = [];
    try {
      kernel.serveModule('labels', osChannel.port1, { setTitle: (title) => titles.push(title) });
      osChannel.port1.start();
      const client: any = openPortClient(systemContracts().os, { channel: osChannel.port2, timeoutMs: 5000 });
      osChannel.port2.start();
      const call = await client.invoke('os.call', { contract: 'records', op: 'records.search', input: { query: 'pine' } });
      assert.deepEqual(call.value, { ok: true, value: [{ id: 'r2', name: 'Pine chair' }] });
      const sent = await client.invoke('mail.send', { subject: 'Printed 2 labels', body: 'Oak table, Pine chair' });
      assert.equal(sent.ok, true);
      assert.deepEqual(kernel.mail().map(m => [m.from, m.to, m.subject, m.read]), [['labels', 'person', 'Printed 2 labels', false]]);
      await client.invoke('window.title', { title: 'Labels — 2 printed' });
      assert.deepEqual(titles, ['Labels — 2 printed']);
      const forged = await client.invoke('mail.send', { subject: 'x', from: 'records-app' });
      assert.equal(forged.ok, false, 'a module cannot name another sender');
    } finally { for (const c of [records, osChannel]) { c.port1.close(); c.port2.close(); } }
  });

  it('lists every granted operation as an assistant tool, routed through the ledger', async () => {
    assert.equal(createKernel().allowed('assistant', 'records', 'records.search'), false, 'the assistant is granted nothing by default');
    const kernel = createKernel({ assistantGrants: 'all', tools: toolbox });
    kernel.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
    const channel = provider(kernel);
    try {
      const tools = kernel.tools();
      const names = tools.list().map((t: any) => t.name).sort();
      assert.deepEqual(names, ['records__records_get', 'records__records_search']);
      const result = await tools.execute('records__records_search', { query: 'oak' });
      assert.ok(JSON.stringify(result).includes('Oak table'), JSON.stringify(result));
      assert.equal(kernel.ledger().at(-1)!.caller, 'assistant');
      const narrowed = createKernel({ assistantGrants: ['records.records.get'], tools: toolbox });
      narrowed.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
      const second = provider(narrowed);
      assert.deepEqual(narrowed.tools().list().map((t: any) => t.name), ['records__records_get']);
      // the same grants as plain data, for an application with its own agent runtime
      assert.deepEqual(narrowed.operations().map(o => [o.tool, o.contract, o.op, o.kind]), [['records__records_get', 'records', 'records.get', 'read']]);
      assert.deepEqual(createKernel().operations(), [], 'nothing granted, nothing listed');
      assert.throws(() => createKernel().tools(), /OS0301/, 'a desktop without a tool builder says so');
      second.port1.close(); second.port2.close();
    } finally { channel.port1.close(); channel.port2.close(); }
  });

  it('installs a suite joined from a link without grants', async () => {
    const kernel = createKernel();
    kernel.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
    kernel.install(manifest('linked', { requires: [{ contract: 'records' }] }), 'suite', { grant: false });
    const channel = provider(kernel);
    try {
      const refused = await kernel.call('linked', 'records', 'records.search', { query: '' });
      assert.equal(!refused.ok && refused.error.code, 'OS0101');
      assert.deepEqual(kernel.grants().linked ?? [], []);
    } finally { channel.port1.close(); channel.port2.close(); }
  });

  it('refuses a module that would take over another module\'s contract', () => {
    const kernel = createKernel();
    kernel.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
    const second = kernel.install(manifest('impostor', { provides: [RECORDS] }), 'suite');
    assert.equal(!second.ok && second.issues[0].code, 'OS0011');
    kernel.install(manifest('plain'), 'suite');
    assert.throws(() => kernel.provideLocal('plain', RECORDS, { 'records.search': () => [] }), /may not serve 'records'/);
    assert.deepEqual(kernel.providers(), []);
  });

  it('keeps a contract served while another window of the same module stays open', async () => {
    const kernel = createKernel();
    kernel.install(manifest('records-app', { provides: [RECORDS] }), 'suite');
    kernel.provideLocal('records-app', RECORDS, { 'records.search': () => ['from w1'], 'records.get': () => ({}) }, 'w1');
    kernel.provideLocal('records-app', RECORDS, { 'records.search': () => ['from w2'], 'records.get': () => ({}) }, 'w2');
    assert.deepEqual(await kernel.call('shell', 'records', 'records.search', { query: '' }), { ok: true, value: ['from w2'] });
    kernel.withdraw('records-app', 'w2');
    assert.deepEqual(await kernel.call('shell', 'records', 'records.search', { query: '' }), { ok: true, value: ['from w1'] });
    kernel.withdraw('records-app', 'w1');
    const gone = await kernel.call('shell', 'records', 'records.search', { query: '' });
    assert.equal(!gone.ok && gone.error.code, 'OS0102');
  });
});

describe('settings', () => {
  const DOC = { kind: 'document', app: { $app: '0.1', state: {}, view: [] } };
  const FORM = { kind: 'form', schema: { type: 'object', additionalProperties: false, properties: { greeting: { type: 'string', maxLength: 20 }, count: { type: 'integer', minimum: 0, maximum: 9 } } } };

  it('fits each kind to its host, keeps a page on the application\'s own origin, and refuses a secret', () => {
    const ok = (m: object) => validateManifest(m).ok;
    const code = (m: object) => { const v = validateManifest(m); return v.ok ? null : v.issues.map(i => i.code); };
    assert.equal(ok(manifest('a', { settings: { kind: 'mount', mount: 'a-settings' } })), true);
    assert.equal(ok({ ...manifest('b'), host: { kind: 'origin', url: 'https://suite.example/app' }, settings: { kind: 'page', url: 'https://suite.example/settings' } }), true);
    assert.equal(ok({ ...manifest('c'), host: DOC, settings: FORM }), true);
    assert.deepEqual(code(manifest('d', { settings: { kind: 'page', url: 'https://suite.example/settings' } })), ['OS0004'], 'a shipped module has a mount, not a page');
    assert.deepEqual(code({ ...manifest('e'), host: { kind: 'origin', url: 'https://suite.example/app' }, settings: { kind: 'page', url: 'https://elsewhere.example/settings' } }), ['OS0004'], 'never another site in the desktop\'s chrome');
    assert.deepEqual(code({ ...manifest('f'), host: DOC, settings: { kind: 'form', schema: { type: 'object', properties: { key: { type: 'string', writeOnly: true } } } } }), ['OS0004']);
    assert.deepEqual(code({ ...manifest('g'), host: DOC, settings: { kind: 'form', schema: { type: 'object', properties: { pin: { type: 'string', format: 'password' } } } } }), ['OS0004']);
    assert.deepEqual([...new Set(code(manifest('h', { settings: { type: 'object' } })))], ['OS0001'], 'a bare schema is not a settings declaration');
  });

  it('keeps a form module\'s values through the host\'s store, checked against its schema', () => {
    const written: [string, unknown][] = [];
    const kernel = createKernel({ settings: { read: () => undefined, write: (module, values) => { written.push([module, values]); } } });
    kernel.install({ ...manifest('notes'), host: DOC, settings: FORM }, 'suite');
    kernel.install(manifest('shop', { settings: { kind: 'mount', mount: 'shop-settings' } }), 'suite');
    const events: string[] = [];
    kernel.subscribe(e => { if (e.kind === 'settings') events.push(e.module!); });
    assert.deepEqual(kernel.setSettings('notes', { greeting: 'Hi', count: 3 }), { ok: true, value: { greeting: 'Hi', count: 3 } });
    assert.deepEqual(written, [['notes', { greeting: 'Hi', count: 3 }]]);
    assert.deepEqual(events, ['notes']);
    const refused = kernel.setSettings('notes', { count: 99 });
    assert.equal(!refused.ok && refused.error.code, 'OS0106');
    assert.equal(written.length, 1, 'refused values are not kept');
    const own = kernel.setSettings('shop', { anything: true });
    assert.equal(!own.ok && own.error.code, 'OS0105', 'an application with its own settings keeps them');
    assert.deepEqual(kernel.settings('shop'), {});
  });

  it('serves a module its own values and opens its own section, over its own port', async () => {
    const kernel = createKernel();
    kernel.install({ ...manifest('notes'), host: DOC, settings: FORM }, 'suite');
    kernel.setSettings('notes', { greeting: 'Hello' });
    let opened = 0;
    const channel = new MessageChannel();
    kernel.serveModule('notes', channel.port1, { openSettings: () => { opened++; } }); channel.port1.start();
    const client: any = openPortClient(systemContracts().os, { channel: channel.port2, timeoutMs: 5000 }); channel.port2.start();
    try {
      assert.deepEqual((await client.invoke('settings.get', {})).value, { values: { greeting: 'Hello' } });
      await client.invoke('settings.open', {});
      assert.equal(opened, 1);
    } finally { channel.port1.close(); channel.port2.close(); }
  });
});
