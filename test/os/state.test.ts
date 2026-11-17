/**
 * The desktop's state: keyed documents loaded once and saved through, kept by
 * whatever store the host chooses (the browser, its server over the
 * `tangle_os_state` contract, or the signed-in application over its port).
 * Nothing is written before it is read, a moved document is taken rather than
 * overwritten, and a failed save is tried again without losing a newer value.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, memoryStore, webStorageStore, contractStore, STATE_CONTRACT, systemContracts, type DesktopStore, type StateDocument } from '@tangleai/os';
import { openLocalClient } from '@jarenjs/contract/local';
import { compileContract } from '@jarenjs/contract';
import { serveDesktopState, memoryStateRepository, DESKTOP_STATE_MODEL } from '@tangleai/os/state-server';

const app = (id: string, extra: object = {}) => ({ $module: '0.1', id, version: '1.0.0', title: { en: id }, host: { kind: 'shipped', mount: id }, ...extra });
const formApp = app('notes', { host: { kind: 'document', app: { $app: '0.1', state: {}, view: [] } }, settings: { kind: 'form', schema: { type: 'object', properties: { greeting: { type: 'string' } } } } });

/** A store whose answers the test releases one at a time. */
function heldStore(inner = memoryStore()) {
  const waiting: (() => void)[] = [];
  let failing = false;
  const store: DesktopStore & { release(): void, fail(on: boolean): void, saves: number } = {
    saves: 0,
    async load() { await new Promise<void>(resolve => waiting.push(resolve)); if (failing) throw new Error('offline'); return inner.load(); },
    async save(doc, ifRevision) { store.saves++; await new Promise<void>(resolve => waiting.push(resolve)); if (failing) throw new Error('offline'); return inner.save(doc, ifRevision); },
    release() { waiting.shift()?.(); },
    fail(on) { failing = on; },
  };
  return { store, inner };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the desktop state in the kernel', () => {
  it('changes nothing until it is loaded, and nothing at all when it cannot be', async () => {
    const { store, inner } = heldStore(memoryStore([{ scope: 'person', key: 'dock', value: { $dock: '0.1', items: ['b', 'a'], hidden: [] }, revision: 4 }]));
    const kernel = createKernel({ state: store });
    assert.equal(kernel.stateStatus().status, 'loading');
    const early = kernel.setDock({ $dock: '0.1', items: ['a'], hidden: [] });
    assert.ok(!early.ok && early.error.code === 'OS0121', 'a dock edit before the load would overwrite the stored one');
    store.release(); await kernel.ready();
    assert.deepEqual(kernel.dock()!.items, ['b', 'a']);
    assert.equal(kernel.stateStatus().status, 'ready');

    const offline = heldStore(inner);
    offline.store.fail(true);
    const cut = createKernel({ state: offline.store });
    offline.store.release(); await cut.ready();
    assert.equal(cut.stateStatus().status, 'unavailable');
    assert.ok(!cut.setDock({ $dock: '0.1', items: ['a'], hidden: [] }).ok);
    offline.store.fail(false);
    const again = cut.reloadState(); offline.store.release(); await again;
    assert.equal(cut.stateStatus().status, 'ready');
  });

  it('saves one at a time per document, the latest value winning, and tries a failed save again', async () => {
    const { store, inner } = heldStore();
    const kernel = createKernel({ state: store });
    store.release(); await kernel.ready();
    kernel.setState('prefs', { theme: 'one' });
    kernel.setState('prefs', { theme: 'two' });
    kernel.setState('prefs', { theme: 'three' });
    assert.deepEqual(kernel.state('prefs'), { theme: 'three' }, 'the desktop shows a change at once');
    assert.equal(store.saves, 1, 'one save in flight');
    store.release(); await tick();
    assert.equal(store.saves, 2, 'then only the latest value');
    store.fail(true); store.release(); await tick();
    assert.equal(kernel.stateStatus().failed, 'offline');
    store.fail(false);
    const done = kernel.flushState(); await tick();
    store.release(); await done;
    // the first value was saved, then only the latest: two revisions, never the one in between
    assert.deepEqual((await inner.load()).map(d => [d.key, d.value, d.revision]), [['prefs', { theme: 'three' }, 2]]);
    assert.equal(kernel.stateStatus().failed, null);
  });

  it('takes a document another device changed instead of overwriting it, and a suggestion made before goes stale', async () => {
    const inner = memoryStore();
    const kernel = createKernel({ state: inner, assistantGrants: ['tangle_os_dock.*'] });
    for (const id of ['a', 'b']) kernel.install(app(id));
    await kernel.ready();
    kernel.setDock({ $dock: '0.1', items: ['a', 'b'], hidden: [] });
    await kernel.flushState();
    await kernel.call('assistant', 'tangle_os_dock', 'dock.suggest', { layout: { $dock: '0.1', items: ['b', 'a'], hidden: [] } });
    // another device saves first
    await inner.save({ scope: 'person', key: 'dock', value: { $dock: '0.1', items: ['b', 'a'], hidden: [] } }, 1);
    kernel.setDock({ $dock: '0.1', items: ['a'], hidden: ['b'] });
    await kernel.flushState();
    assert.deepEqual(kernel.dock(), { $dock: '0.1', items: ['b', 'a'], hidden: [] }, 'the stored document wins');
    const suggestion = kernel.mail().find(m => m.from === 'desktop')!;
    const decided = await kernel.decide(suggestion.id, 'accept');
    assert.ok(!decided.ok && decided.error.code === 'OS0112');
  });

  it("keeps a form application's settings and the host's own documents, but never a key of the desktop's", async () => {
    const inner = memoryStore();
    const kernel = createKernel({ state: inner });
    kernel.install(formApp);
    await kernel.ready();
    assert.equal(kernel.setSettings('notes', { greeting: 'Hoi' }).ok, true);
    assert.equal(kernel.setState('preferences', { scheme: 'dark' }).ok, true);
    assert.equal(kernel.setState('appearance', { density: 'compact' }, 'application').ok, true);
    const reserved = kernel.setState('dock', {});
    assert.ok(!reserved.ok && reserved.error.code === 'OS0120');
    await kernel.flushState();
    const fresh = createKernel({ state: inner });
    fresh.install(formApp);
    await fresh.ready();
    assert.deepEqual([fresh.settings('notes'), fresh.state('preferences'), fresh.state('appearance', 'application')], [{ greeting: 'Hoi' }, { scheme: 'dark' }, { density: 'compact' }]);
  });

  it('a browser store keeps one entry per document', async () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => { entries.set(k, v); }, removeItem: (k: string) => { entries.delete(k); }, key: (i: number) => [...entries.keys()][i] ?? null, get length() { return entries.size; } };
    const store = webStorageStore(storage);
    assert.deepEqual(await store.save({ scope: 'person', key: 'dock', value: { x: 1 } }, 0), { revision: 1 });
    assert.ok('conflict' in await store.save({ scope: 'person', key: 'dock', value: { x: 2 } }, 0));
    assert.deepEqual([...entries.keys()], ['tangle-os-state:person:dock']);
    assert.deepEqual((await store.load()).map(d => d.value), [{ x: 1 }]);
  });
});

describe('a server keeps the desktop state', () => {
  it("serves the contract over a compare-and-set repository, each person's own documents and the application's", async () => {
    const repository = memoryStateRepository();
    const contract = compileContract(STATE_CONTRACT as any);
    const as = (owner: { person: string, application: string }) => contractStore(openLocalClient(contract, serveDesktopState(repository, () => owner) as any) as any);
    const ann = as({ person: 'ann', application: 'acme' }), bob = as({ person: 'bob', application: 'acme' });
    assert.deepEqual(await ann.save({ scope: 'person', key: 'dock', value: { a: 1 } }, 0), { revision: 1 });
    assert.deepEqual(await ann.save({ scope: 'application', key: 'tiles', value: { t: 1 } }, 0), { revision: 1 });
    assert.deepEqual((await bob.load()).map((d: StateDocument) => [d.scope, d.key]), [['application', 'tiles']], "Bob reads the application's documents, not Ann's");
    const moved = await bob.save({ scope: 'application', key: 'tiles', value: { t: 2 } }, 0);
    assert.ok('conflict' in moved && moved.conflict.revision === 1);
    assert.deepEqual(await ann.save({ scope: 'person', key: 'dock', value: null }, 1), { revision: 2 });
    assert.deepEqual((await ann.load()).map((d: StateDocument) => d.key), ['tiles']);
    assert.equal(DESKTOP_STATE_MODEL.$model, '0.1');
    assert.ok(DESKTOP_STATE_MODEL.collections.desktop_state.indexes.some((i: any) => i.name === 'by_owner'));
  });

  it('the signed-in application serves the state over its port; the desktop loads it once it connects', async () => {
    const repository = memoryStateRepository();
    const kernel = createKernel({ state: { module: 'suite' } });
    kernel.install(app('suite', { host: { kind: 'origin', url: 'https://suite.example/' }, provides: [STATE_CONTRACT] }), 'suite');
    assert.equal(kernel.stateStatus().status, 'loading');
    kernel.provideLocal('suite', STATE_CONTRACT, serveDesktopState(repository, () => ({ person: 'ann', application: 'acme' })) as any);
    await kernel.ready();
    assert.equal(kernel.stateStatus().status, 'ready');
    kernel.setDock({ $dock: '0.1', items: ['suite'], hidden: [] });
    await kernel.flushState();
    assert.deepEqual((await repository.list({ person: 'ann', application: 'acme' })).map(d => d.key), ['dock']);
    assert.ok(systemContracts());
  });
});
