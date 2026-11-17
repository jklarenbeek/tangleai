/**
 * The dock as a document: icons from manifests (one per module, or one per
 * launch entry), a person's layout arranged over them, and every edit as a
 * pure function that keeps each icon exactly once.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeDock, dockIcons, folderTitles, normalizeDock, moveInDock, hideInDock, showInDock, groupInDock, renameDockFolder, dockChanges, emptyDock,
  validateManifest, type DockLayout, type ModuleManifest,
} from '@tangleai/os';

const app = (id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest => ({ $module: '0.1', id, version: '1.0.0', title: { en: id }, host: { kind: 'shipped', mount: id }, ...extra });
/** A suite of one page whose screens are launch entries, in two folders it names. */
const SUITE = app('suite', {
  host: { kind: 'origin', url: 'https://suite.example/' },
  entries: [
    { id: 'staff', title: { en: 'Staff', nl: 'Personeel' }, screen: '/staff', folder: 'people' },
    { id: 'leave', title: { en: 'Leave' }, screen: '/leave', folder: 'people' },
    { id: 'rota', title: { en: 'Rota' }, screen: '/rota', folder: 'planning' },
    { id: 'shifts', title: { en: 'Shifts' }, screen: '/shifts', folder: 'planning' },
    { id: 'home', title: { en: 'Home' }, screen: '/' },
  ],
  dock: { folders: [{ id: 'people', title: { en: 'People', nl: 'Mensen' } }, { id: 'planning', title: { en: 'Planning' } }] },
});
const ids = (layout: DockLayout) => JSON.stringify(layout.items.map(i => typeof i === 'string' ? i : [i.folder, ...i.items]));
const view = (manifests: ModuleManifest[], saved: DockLayout | null = null, locale = 'en') => {
  const { layout, view } = arrangeDock(saved, dockIcons(manifests, locale), folderTitles(manifests, locale));
  return { layout, shown: view.items.map(i => i.kind === 'icon' ? i.icon.id : `${i.title}[${i.icons.map(x => x.id).join(',')}]`), hidden: view.hidden.map(i => i.id) };
};

describe('icons and the first arrangement', () => {
  it('without a layout or folders, the dock is every module in install order, as it always was', () => {
    assert.deepEqual(view([app('a'), app('b'), app('c')]).shown, ['a', 'b', 'c']);
  });
  it('one manifest puts each launch entry in the dock, in the folders it names, titled in the desktop language', () => {
    const { shown } = view([app('calendar'), SUITE], null, 'nl');
    assert.deepEqual(shown, ['calendar', 'Mensen[suite/staff,suite/leave]', 'Planning[suite/rota,suite/shifts]', 'suite/home']);
    const icons = dockIcons([SUITE], 'nl');
    assert.deepEqual([icons[0].title, icons[0].screen, icons[0].module], ['Personeel', '/staff', 'suite']);
  });
  it("a suite of many modules shares folder ids; a manifest's defaults apply only to an icon seen for the first time", () => {
    const stock = (id: string) => app(id, { dock: { folder: 'stock', folders: [{ id: 'stock', title: { en: 'Stock' } }] } });
    const first = view([app('till'), stock('warehouse'), stock('purchasing')]);
    assert.deepEqual(first.shown, ['till', 'Stock[warehouse,purchasing]']);
    // the person takes warehouse out; on the next boot the manifest does not put it back
    const moved = moveInDock(first.layout, 'warehouse', 0);
    assert.deepEqual(view([app('till'), stock('warehouse'), stock('purchasing')], moved).shown, ['warehouse', 'till', 'purchasing']);
  });
  it('an icon whose module is gone stays in the layout, out of the view, and returns to its place', () => {
    const layout = normalizeDock({ $dock: '0.1', items: ['a', 'gone', 'b'], hidden: [] });
    assert.deepEqual(view([app('a'), app('b')], layout).shown, ['a', 'b']);
    assert.deepEqual(view([app('a'), app('gone'), app('b')], layout).shown, ['a', 'gone', 'b']);
  });
});

describe('editing keeps every icon exactly once', () => {
  const start = (): DockLayout => view([app('a'), app('b'), app('c'), app('d')]).layout;
  it('moves an icon and a folder', () => {
    assert.equal(ids(moveInDock(start(), 'a', 3)), '["b","c","a","d"]');
    assert.equal(ids(moveInDock(start(), 'd', 0)), '["d","a","b","c"]');
    const grouped = groupInDock(start(), 'c', 'a', 'f');
    assert.equal(ids(moveInDock(grouped, 'f', 3)), '["b","d",["f","a","c"]]');
  });
  it('hides and shows', () => {
    const hidden = hideInDock(start(), 'b');
    assert.deepEqual([ids(hidden), hidden.hidden], ['["a","c","d"]', ['b']]);
    assert.deepEqual([ids(showInDock(hidden, 'b')), showInDock(hidden, 'b').hidden], ['["a","c","d","b"]', []]);
  });
  it('drops an icon on another to make a folder, on a folder to join it, and dissolves a folder of one', () => {
    const folder = groupInDock(start(), 'c', 'a', 'f');
    assert.equal(ids(folder), '[["f","a","c"],"b","d"]');
    const joined = groupInDock(folder, 'd', 'f', 'g');
    assert.equal(ids(joined), '[["f","a","c","d"],"b"]');
    assert.equal(ids(groupInDock(joined, 'b', 'c', 'g')), '[["f","a","c","d","b"]]', 'dropped on an icon inside a folder joins that folder');
    const out = moveInDock(moveInDock(folder, 'a', 1), 'c', 0);
    assert.equal(ids(out), '["c","a","b","d"]', 'taking out all but one dissolves the folder');
    assert.equal(ids(groupInDock(groupInDock(start(), 'b', 'a', 'f'), 'd', 'c', 'f')), '[["f","a","b"],["f-2","c","d"]]', 'a new folder never takes an id in use');
  });
  it('names a folder, and an empty name goes back to the default', () => {
    const named = renameDockFolder(groupInDock(start(), 'b', 'a', 'f'), 'f', '  Work  ');
    assert.equal((named.items[0] as any).title, 'Work');
    assert.equal((renameDockFolder(named, 'f', ' ').items[0] as any).title, undefined);
    assert.deepEqual(view([app('a'), app('b')], named).shown, ['Work[a,b]']);
  });
  it('normalizing twice changes nothing, and an id kept twice keeps its first place', () => {
    const messy: DockLayout = { $dock: '0.1', items: ['a', { folder: 'f', items: ['a', 'b'] }, { folder: 'g', items: [] }, 'b', 'c'], hidden: ['c'] };
    const once = normalizeDock(messy);
    assert.deepEqual(once, normalizeDock(once));
    assert.equal(ids(once), '["a","b"]');
    assert.deepEqual(once.hidden, ['c']);
  });
  it('says what a suggested layout would change', () => {
    const before = start();
    const after = hideInDock(groupInDock(before, 'c', 'b', 'f'), 'd');
    assert.deepEqual(dockChanges(before, after), { moved: ['b', 'c'], hidden: ['d'], shown: [], folders: [{ id: 'f', items: ['b', 'c'] }] });
    assert.deepEqual(dockChanges(after, after), { moved: [], hidden: [], shown: [], folders: [] });
    assert.deepEqual(emptyDock(), { $dock: '0.1', items: [], hidden: [] });
  });
});

describe('the manifest', () => {
  it('accepts launch entries and folders, and refuses one named twice', () => {
    assert.equal(validateManifest(SUITE).ok, true, JSON.stringify(validateManifest(SUITE)));
    const twice = validateManifest({ ...SUITE, entries: [...SUITE.entries!, { id: 'staff', title: { en: 'Again' } }] });
    assert.ok(!twice.ok && twice.issues.some(i => i.code === 'OS0005' && i.path === '/entries/5/id'));
    const folders = validateManifest({ ...SUITE, dock: { folders: [{ id: 'x', title: { en: 'X' } }, { id: 'x', title: { en: 'Y' } }] } });
    assert.ok(!folders.ok && folders.issues.some(i => i.code === 'OS0005'));
    const shape = validateManifest({ ...SUITE, dock: { folder: 'bad id!' } });
    assert.ok(!shape.ok && shape.issues[0].code === 'OS0001');
  });
});

describe('the dock in the kernel', () => {
  it('keeps a checked layout in the desktop state, moves its revision, and ignores it on a recovery boot', async () => {
    const { createKernel, memoryStore } = await import('@tangleai/os');
    const store = memoryStore();
    const kernel = createKernel({ state: store });
    await kernel.ready();
    const events: string[] = [];
    kernel.subscribe(e => { if (e.kind === 'dock') events.push(e.kind); });
    assert.equal(kernel.dock(), null);
    assert.equal(kernel.setDock({ $dock: '0.1', items: ['a', 'a', 'b'], hidden: [] }).ok, true);
    await kernel.flushState();
    assert.deepEqual(store.documents(), [{ scope: 'person', key: 'dock', value: { $dock: '0.1', items: ['a', 'b'], hidden: [] }, revision: 1 }], 'kept normalized');
    assert.equal(kernel.dockRevision(), 1);
    const bad = kernel.setDock({ $dock: '0.1', items: [{ folder: 'f' }], hidden: [] });
    assert.ok(!bad.ok && bad.error.code === 'OS0119');
    assert.deepEqual(events, ['dock']);
    const recovered = createKernel({ state: store, recovery: true });
    await recovered.ready();
    assert.equal(recovered.dock(), null);
  });

  it('refuses a module that takes an id of the desktop', async () => {
    const { createKernel } = await import('@tangleai/os');
    const verdict = createKernel().install(app('desktop'));
    assert.ok(!verdict.ok && verdict.issues[0].code === 'OS0012');
  });

  it('takes the assistant\'s suggestion to the inbox; the person accepts it unless the dock moved meanwhile', async () => {
    const { createKernel } = await import('@tangleai/os');
    const kernel = createKernel({ assistantGrants: ['tangle_os_dock.*'] });
    for (const id of ['a', 'b', 'c']) kernel.install(app(id));
    const read: any = await kernel.call('assistant', 'tangle_os_dock', 'dock.read', {});
    assert.deepEqual(read.value.items.map((i: any) => i.icon?.id), ['a', 'b', 'c']);
    const layout = groupInDock(read.value.layout, 'c', 'a', 'tools');
    const filed: any = await kernel.call('assistant', 'tangle_os_dock', 'dock.suggest', { layout });
    assert.equal(filed.ok, true);
    const again: any = await kernel.call('assistant', 'tangle_os_dock', 'dock.suggest', { layout });
    assert.equal(kernel.mail().filter(m => m.from === 'desktop').length, 1, 'one suggestion per caller: a new one replaces it');
    assert.equal(again.ok, true);
    const item = kernel.mail().find(m => m.from === 'desktop')!;
    // what the person reads is derived from the two layouts, never the caller's own description
    assert.deepEqual((item.proposal!.payload as any).changes, { moved: ['a', 'c', 'b'], hidden: [], shown: [], folders: [{ id: 'tools', items: ['a', 'c'] }] });
    assert.equal(kernel.dock(), null, 'nothing changes before the person decides');
    // the person moves something first: the suggestion no longer fits
    kernel.setDock(moveInDock(read.value.layout, 'b', 0));
    const stale = await kernel.decide(item.id, 'accept');
    assert.ok(!stale.ok && stale.error.code === 'OS0112');
    assert.equal(kernel.mail().find(m => m.id === item.id)!.proposal!.status, 'pending');
    await kernel.call('assistant', 'tangle_os_dock', 'dock.suggest', { layout });
    assert.equal((await kernel.decide(item.id, 'accept')).ok, true);
    assert.equal(ids(kernel.dock()!), '[["tools","a","c"],"b"]');
    const stranger = await kernel.call('records', 'tangle_os_dock', 'dock.suggest', { layout });
    assert.ok(!stranger.ok && stranger.error.code === 'OS0101');
  });
});
