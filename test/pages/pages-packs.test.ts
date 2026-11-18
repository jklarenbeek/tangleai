/**
 * The Pages desktop's own packs: each has every key of the English catalogue,
 * the same kind of entry and the same placeholders, its closures render a
 * sentence for any count, and the Settings window is named with the chrome's
 * own word for Settings, so a person never sees two names for it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pagesMessagesEn } from '../../apps/pages/src/os/messages.ts';
import { PAGES_PACKS } from '../../apps/pages/src/os/packs.ts';
import { catalogues } from '../../apps/pages/src/os/language.ts';

const holes = (text: string) => [...text.replace(/\{\{/g, '').matchAll(/\{([A-Za-z]+)\}/g)].map(m => m[1]).sort();
const english = pagesMessagesEn as Record<string, string | ((p: any) => string)>;

describe('the Pages desktop packs', () => {
  for (const [lang, pack] of Object.entries(PAGES_PACKS) as [string, Record<string, any>][]) {
    it(`${lang} has every sentence, in the same shape, and names Settings as the chrome does`, () => {
      assert.deepEqual(Object.keys(pack).sort(), Object.keys(english).sort());
      for (const [key, en] of Object.entries(english)) {
        assert.equal(typeof pack[key], typeof en, `${lang} ${key} is the same kind of entry`);
        if (typeof en === 'string') assert.deepEqual(holes(pack[key]), holes(en), `${lang} ${key} keeps its placeholders`);
        else for (const count of [0, 1, 2, 5, 21]) {
          const out = pack[key]({ count, limit: 50, day: 31, used: '$1', limit2: null, freeTier: false, novelty: true, contradiction: false, crystallization: true, dims: 8 });
          assert.ok(typeof out === 'string' && out.trim() && !/undefined|NaN/.test(out), `${lang} ${key} renders for ${count}`);
        }
      }
      assert.equal(pack['apps/settings'], catalogues(lang).os?.['menu/settings']);
    });
  }
});
