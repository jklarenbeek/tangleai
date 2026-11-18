/**
 * The Pages desktop's one language choice: the person's, else the first of
 * the browser's the desktop speaks, else English; and every catalogue for it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES, catalogues, dirOf, resolveLanguage, supported } from '../../apps/pages/src/os/language.ts';

describe('the desktop language', () => {
  it('follows the browser until the person chooses, and only in a language it speaks', () => {
    assert.equal(resolveLanguage('system', ['fy-NL', 'nl-BE', 'en']), 'nl');
    assert.equal(resolveLanguage(undefined, ['zh-Hant-TW']), 'zh-TW');
    assert.equal(resolveLanguage(undefined, ['zh-CN', 'ja']), 'ja', 'Simplified Chinese is not Traditional');
    assert.equal(resolveLanguage(undefined, ['sv', 'fi']), 'en');
    assert.equal(resolveLanguage('ar', ['de']), 'ar', 'the person\'s choice wins');
    assert.equal(resolveLanguage('xx', ['de']), 'de', 'an unknown choice falls back to the browser');
    assert.equal(supported('pt-BR'), 'pt');
    assert.equal(dirOf('ar'), 'rtl');
    assert.equal(dirOf('ja'), 'ltr');
    assert.equal(LANGUAGES.length, 12);
  });

  it('gives every catalogue of a language, and the sentinel for every key', () => {
    assert.deepEqual(catalogues('en'), {});
    const de = catalogues('de');
    assert.equal(de.os?.['menu/settings'], 'Einstellungen');
    assert.ok(de.assistant, 'the assistant speaks it too');
    const sentinel = catalogues('sentinel');
    assert.equal(sentinel.os?.['menu/settings'], '⟦menu/settings⟧');
    assert.equal(sentinel.pages, 'sentinel');
  });
});
