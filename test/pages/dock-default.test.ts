/**
 * The dock a person has not arranged mirrors the Jaren website's menu:
 * Engines, Studios and Learn as folders, the everyday applications beside
 * them, and the data transfer among the hidden icons, titled in the desktop's
 * language. A saved arrangement is never changed by these defaults.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeDock, dockIcons, folderTitles, emptyDock, moveInDock } from '@tangleai/os';
import { builtinModules } from '../../apps/pages/src/os/modules.ts';

const arranged = (locale = 'en', saved = null as any) => {
  const manifests = builtinModules();
  const { layout, view } = arrangeDock(saved, dockIcons(manifests, locale), folderTitles(manifests, locale));
  return {
    layout,
    shown: view.items.map(i => i.kind === 'icon' ? i.icon.id : `${i.title}[${i.icons.map(x => x.id).join(',')}]`),
    hidden: view.hidden.map(i => i.id),
  };
};

describe('the default dock', () => {
  it('groups the applications as the Jaren website groups its menu', () => {
    const { shown, hidden } = arranged();
    assert.deepEqual(shown, [
      'assistant',
      'Engines[playground,charts,collections,adventure,loop]',
      'Studios[studio,flow,data,calculator,converter]',
      'Learn[welcome,docs,benchmarks,about]',
      'calendar', 'todo', 'settings',
    ]);
    assert.deepEqual(hidden, ['transfer']);
  });

  it('names the folders in the desktop language', () => {
    assert.deepEqual(arranged('nl').shown.filter(s => s.includes('[')).map(s => s.split('[')[0]), ['Engines', "Studio's", 'Leren']);
    assert.deepEqual(arranged('ja').shown.filter(s => s.includes('[')).map(s => s.split('[')[0]), ['エンジン', 'スタジオ', '学ぶ']);
  });

  it('leaves an arrangement the person saved as it is, and an empty one is the default again', () => {
    const mine = moveInDock(arranged().layout, 'settings', 0);
    assert.equal(arranged('en', mine).shown[0], 'settings');
    assert.deepEqual(arranged('en', emptyDock()).shown, arranged().shown);
  });
});
