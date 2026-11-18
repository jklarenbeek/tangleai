/**
 * Joining applications with the person's consent: the kernel grants exactly
 * what they allowed, keeps the assistant out of an application they did not
 * open to it (even on a desktop that grants the assistant everything), keeps
 * the installs in their state for the next visit, and asks again only when an
 * application asks for more than they were shown.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, memoryStore } from '@tangleai/os';
import { consentNeeded, isLocalOrigin, originOf, scopesOf } from '../../components/os/src/consent.ts';

const RECORDS = { $contract: '0.1', id: 'records', operations: { 'records.search': { kind: 'read', input: { type: 'object' }, output: { type: 'array' } } } };
const catalogue = (extra: Record<string, unknown> = {}) => ({
  $module: '0.1', id: 'catalogue', version: '1.0.0', title: { en: 'Catalogue' },
  host: { kind: 'origin', url: 'http://127.0.0.1:4722/index.html' },
  provides: [RECORDS],
  requires: [{ contract: 'tangle_os_files', operations: ['files.list'] }, { contract: 'labels' }],
  ...extra,
});

async function desktop(store = memoryStore(), options: Record<string, unknown> = {}) {
  const kernel = createKernel({ assistantGrants: 'all', state: store, ...options });
  await kernel.ready();
  return kernel;
}

describe('what a consent sheet shows', () => {
  it('derives the scopes, the origin and whether a browser may ask about the local network', () => {
    assert.deepEqual(scopesOf(catalogue() as any), ['tangle_os_files.files.list', 'labels.*']);
    assert.equal(originOf(catalogue() as any), 'http://127.0.0.1:4722');
    assert.equal(originOf({ host: { kind: 'document' } } as any), null);
    for (const local of ['http://127.0.0.1:1', 'http://localhost:5173', 'http://192.168.1.4', 'http://10.0.0.2', 'http://shop.local', 'http://[::1]:80']) assert.equal(isLocalOrigin(local), true, local);
    for (const remote of ['https://example.org', 'https://172.32.0.1', null]) assert.equal(isLocalOrigin(remote), false, String(remote));
  });

  it('asks again only for more than was shown, or another origin', () => {
    const before = { origin: 'http://127.0.0.1:4722', offered: ['tangle_os_files.files.list', 'labels.*'], scopes: [], provides: ['records'], assistant: false, at: 0 };
    assert.deepEqual(consentNeeded(catalogue() as any, null), { needed: true, reason: 'new', scopes: ['tangle_os_files.files.list', 'labels.*'], provides: ['records'] });
    assert.deepEqual(consentNeeded(catalogue() as any, before), { needed: false }, 'declining a scope is not asked again');
    assert.deepEqual(consentNeeded(catalogue({ requires: [{ contract: 'labels' }, { contract: 'mail' }] }) as any, before), { needed: true, reason: 'more', scopes: ['mail.*'], provides: [] });
    assert.equal((consentNeeded(catalogue({ host: { kind: 'origin', url: 'https://elsewhere.example/' } }) as any, before) as any).reason, 'origin');
  });
});

describe('joining an application', () => {
  it('grants exactly what the person allowed, and nothing it did not ask for', async () => {
    const kernel = await desktop();
    const refused = kernel.join(catalogue(), { scopes: ['mail.*'], assistant: false });
    assert.equal(refused.ok, false);
    assert.equal((refused as any).error.code, 'OS0140');
    const joined = kernel.join(catalogue(), { scopes: ['labels.*'], assistant: false, source: 'http://127.0.0.1:4722/suite.json' });
    assert.equal(joined.ok, true);
    assert.equal(kernel.layerOf('catalogue'), 'user');
    assert.deepEqual(kernel.grants().catalogue, ['labels.*']);
    assert.deepEqual(kernel.consentOf('catalogue'), { source: 'http://127.0.0.1:4722/suite.json', origin: 'http://127.0.0.1:4722', offered: ['tangle_os_files.files.list', 'labels.*'], scopes: ['labels.*'], provides: ['records'], assistant: false, at: (kernel.consentOf('catalogue') as any).at });
    assert.equal(kernel.allowed('catalogue', 'labels', 'labels.print'), true);
    assert.equal(kernel.allowed('catalogue', 'tangle_os_files', 'files.list'), false, 'a scope the person declined');
  });

  it('updates an application joined before in place, so undo does not take it away', async () => {
    const kernel = await desktop();
    kernel.join(catalogue(), { scopes: ['labels.*'], assistant: false });
    kernel.patch('catalogue', [{ op: 'replace', path: '/title/en', value: 'My catalogue' }]);
    assert.equal(kernel.join(catalogue({ version: '1.1.0' }), { scopes: ['labels.*'], assistant: false }).ok, true);
    assert.equal(kernel.effective('catalogue')?.version, '1.1.0');
    assert.equal(kernel.undo().ok, true, 'the undo takes back the rename');
    assert.equal(kernel.effective('catalogue')?.title.en, 'Catalogue');
    assert.equal(kernel.layerOf('catalogue'), 'user');
  });

  it('keeps the assistant out until the person opens the application to it, on a desktop that grants it everything', async () => {
    const kernel = await desktop();
    kernel.join(catalogue(), { scopes: [], assistant: false });
    kernel.provideLocal('catalogue', RECORDS, { 'records.search': () => [{ id: 'r1' }] });
    assert.equal(kernel.allowed('assistant', 'records', 'records.search'), false);
    assert.equal(kernel.operations().some(o => o.contract === 'records'), false);
    const call = await kernel.call('assistant', 'records', 'records.search', {});
    assert.equal(call.ok, false);
    assert.equal((call as any).error.code, 'OS0101');
    assert.equal((await kernel.call('shell', 'records', 'records.search', {})).ok, true, 'the person still reaches it');

    assert.equal(kernel.setConsent('catalogue', { assistant: true }).ok, true);
    assert.equal(kernel.allowed('assistant', 'records', 'records.search'), true);
    assert.deepEqual(await kernel.call('assistant', 'records', 'records.search', {}), { ok: true, value: [{ id: 'r1' }] });
    assert.equal(kernel.setConsent('notes', { assistant: true }).ok, false, 'only a joined application has a consent to change');
  });

  it('keeps its header bar and its files from the assistant without consent', async () => {
    const kernel = await desktop();
    kernel.join(catalogue({ files: { contract: 'catalogue_files' }, provides: [RECORDS, { $contract: '0.1', id: 'catalogue_files', operations: { 'files.list': { kind: 'read', input: { type: 'object' }, output: { type: 'object' } } } }] }), { scopes: [], assistant: false });
    assert.equal(kernel.fileLocations()[0].assistant, false);
    assert.equal(kernel.setHeader('catalogue', 'w1', { start: [{ kind: 'button', id: 'refresh', label: 'Refresh' }] }).ok, true);
    kernel.registerHeaderHandler('catalogue', 'w1', async () => ({}));
    assert.deepEqual(kernel.headers('assistant'), []);
    assert.equal(kernel.headers('shell').length, 1);
    const used = await kernel.activateHeader('assistant', 'w1', 'refresh');
    assert.equal((used as any).error?.code, 'OS0115');
    kernel.setConsent('catalogue', { assistant: true });
    assert.equal(kernel.headers('assistant').length, 1);
    assert.equal(kernel.fileLocations()[0].assistant, true);
  });
});

describe('installed applications in the person state', () => {
  it('are there on the next visit, with their grants, and stay out of a recovery boot', async () => {
    const store = memoryStore();
    const first = await desktop(store);
    first.join(catalogue(), { scopes: ['labels.*'], assistant: true });
    await first.flushState();
    const kept = store.documents().find(d => d.key === 'apps');
    assert.equal((kept?.value as any).apps[0].manifest.id, 'catalogue');

    const next = await desktop(store);
    assert.equal(next.layerOf('catalogue'), 'user');
    assert.deepEqual(next.grants().catalogue, ['labels.*']);
    assert.equal(next.consentOf('catalogue')?.assistant, true);
    assert.equal(next.setState('apps', {}).ok, false, 'the kept list is the kernel\'s own key');

    const recovery = await desktop(store, { recovery: true });
    assert.equal(recovery.effective('catalogue'), null);
  });

  it('removes and undoes the removal together with the consent', async () => {
    const store = memoryStore();
    const kernel = await desktop(store);
    kernel.join(catalogue(), { scopes: ['labels.*'], assistant: true });
    assert.equal(kernel.remove('catalogue').ok, true);
    await kernel.flushState();
    assert.deepEqual(store.documents().find(d => d.key === 'apps')?.value, { apps: [] });
    assert.equal(kernel.undo().ok, true);
    await kernel.flushState();
    assert.equal(kernel.consentOf('catalogue')?.assistant, true);
    assert.deepEqual(kernel.grants().catalogue, ['labels.*']);
    assert.equal((store.documents().find(d => d.key === 'apps')?.value as any).apps.length, 1);
  });

  it('takes the list another device kept instead of overwriting it', async () => {
    const store = memoryStore();
    const here = await desktop(store);
    here.join(catalogue(), { scopes: [], assistant: false });
    await here.flushState();
    const there = await desktop(store);
    there.setConsent('catalogue', { assistant: true });
    await there.flushState();
    // this device has not seen that change: its removal conflicts, and the kept list wins
    here.remove('catalogue');
    await here.flushState();
    assert.equal(here.layerOf('catalogue'), 'user');
    assert.equal(here.consentOf('catalogue')?.assistant, true);
  });

  it('refuses to join before the state has loaded', () => {
    const kernel = createKernel({ state: { load: () => new Promise(() => {}), save: async () => ({ revision: 1 }) } });
    const refused = kernel.join(catalogue(), { scopes: [], assistant: false });
    assert.equal((refused as any).error.code, 'OS0121');
    assert.equal(kernel.layerOf('catalogue'), null);
  });
});
