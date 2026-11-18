/**
 * The desktop's chrome in the eleven languages `@jarenjs/locales` ships: each
 * pack has every key of the English catalogue and no other, keeps each
 * sentence's placeholders, and leaves no sentence in English beyond product
 * names.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { osMessagesEn, createOsMessages } from '@tangleai/os';
import { ar } from '@tangleai/os/messages/ar';
import { de } from '@tangleai/os/messages/de';
import { es } from '@tangleai/os/messages/es';
import { fr } from '@tangleai/os/messages/fr';
import { ja } from '@tangleai/os/messages/ja';
import { ko } from '@tangleai/os/messages/ko';
import { nl } from '@tangleai/os/messages/nl';
import { pt } from '@tangleai/os/messages/pt';
import { ru } from '@tangleai/os/messages/ru';
import { tr } from '@tangleai/os/messages/tr';
import { zhTW } from '@tangleai/os/messages/zh-tw';

const PACKS = { ar, de, es, fr, ja, ko, nl, pt, ru, tr, 'zh-TW': zhTW } as Record<string, Record<string, string>>;
const holes = (text: string) => [...text.matchAll(/\{([a-z]+)\}/g)].map(m => m[1]).sort();
/** Sentences that are names in every language. */
const NAMES = new Set(['OpenRouter', 'Tangle', 'Tangle OS']);
/** Words a language writes as English does, by key. */
const SAME: Record<string, string[]> = { nl: ['mail/title'], de: ['mail/title'], fr: ['dock/label', 'settings/applications'] };

describe('the desktop chrome packs', () => {
  for (const [lang, pack] of Object.entries(PACKS)) {
    it(`${lang} has every key, keeps every placeholder and leaves nothing in English`, () => {
      assert.deepEqual(Object.keys(pack).sort(), Object.keys(osMessagesEn).sort());
      for (const [key, english] of Object.entries(osMessagesEn)) {
        assert.equal(typeof pack[key], 'string', key);
        assert.ok(pack[key].trim(), `${lang} ${key} is empty`);
        assert.deepEqual(holes(pack[key]), holes(english), `${lang} ${key} keeps its placeholders`);
        if (!NAMES.has(english) && !(SAME[lang] ?? []).includes(key)) assert.notEqual(pack[key], english, `${lang} ${key} is still English`);
      }
      // a pack fills its placeholders like the English one
      assert.ok(createOsMessages(pack)('dock/open', { title: 'Notes' }).includes('Notes'));
    });
  }
});
