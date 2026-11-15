/**
 * The Pages playground keeps the reader's message language and the schema
 * author's own error text, as Jaren's play host kit does: only the reader
 * sets the language, and a choice survives loading another example, New
 * and an opened session; a session carries no language, so it opens in its
 * reader's; an example made to show one language shows it for its own run;
 * the text a schema's `errorMessage` wrote stays as written in every
 * locale; and the generated form's chrome follows the language.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mountPlay } from '../../apps/pages/src/demos/playground/mount-play.ts';
import { formLabelsFor, localizeErrors, runValidation } from '../../apps/pages/src/demos/playground/validator.ts';
import { sessionOf, withPlayLocale } from '../../apps/pages/src/demos/playground/play.ts';
import { createStubHost } from '../assistant/dom.stub.ts';

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 3, errorMessage: 'Write the full name, please' },
    code: { type: 'string', minLength: 3, errorMessage: { $msgid: 'order/code-short', message: 'The code is too short' } },
    age: { type: 'integer', minimum: 13 },
  },
});

function mount() {
  const { container } = createStubHost();
  return mountPlay(container as any, { debounceMs: 0, schedule: (f: any) => f(), onError: (error: any) => { throw error; } });
}

/** The error table's rows (path, message) of the last run: the run's timings left out. */
const errorRows = (play: any) => play.read().result.panels.find((panel: any) => panel.id === 'errors').rows;
const choose = (play: any, locale: string) => play.dispatch('play/option', { key: 'locale' }, { target: { value: locale }, type: 'change' });

describe('the playground message language', () => {
  it('keeps the text a schema wrote, inline or as a $msgid fallback, in every locale', () => {
    const report = runValidation(SCHEMA, { name: 'A', code: 'x', age: 7 });
    const byPath = (errors: any[]) => Object.fromEntries(errors.map((e: any) => [e.instancePath, e.message]));
    const de = byPath(localizeErrors(report.errors, 'de'));
    assert.equal(de['/name'], 'Write the full name, please');
    assert.equal(de['/code'], 'The code is too short');
    assert.notEqual(de['/age'], byPath(report.errors)['/age'], 'a stock message still renders German');
    assert.equal(byPath(report.errors)['/name'], 'Write the full name, please', 'the cached report is not localized in place');
  });

  it('survives another example, New and an opened session once chosen', () => {
    const play = mount();
    try {
      play.dispatch('play/example', 'validate-invalid');
      const english = errorRows(play);
      choose(play, 'de');
      assert.equal(play.read().locale, 'de');
      const german = errorRows(play);
      assert.deepEqual(german.find(([path]: any) => path === '/age'), ['/age', 'muss >= 13 sein'], 'the run re-renders its errors in German');
      assert.notDeepEqual(german, english);

      play.dispatch('play/example', 'validate-user');
      play.dispatch('play/example', 'validate-invalid');
      assert.equal(play.read().locale, 'de');
      assert.equal(withPlayLocale(play.read()).config.locale, 'de');
      assert.deepEqual(errorRows(play), german, 'a stock example no longer resets the language');

      play.dispatch('play/new');
      assert.equal(play.read().locale, 'de');

      play.replace({ engine: 'validate', source: { schema: SCHEMA }, data: { data: '{"age": 7}' }, config: { locale: 'fr' } }, 'opened');
      assert.equal(play.read().locale, 'de', "the reader's choice wins over the session's");
      assert.equal(withPlayLocale(play.read()).config.locale, 'de');
      assert.equal(sessionOf(play.read()).config.locale, undefined, 'a saved session carries no language');
    } finally { play.dispose(); }
  });

  it("opens a session in its reader's language, never the one it was saved in", () => {
    const play = mount();
    try {
      play.replace({ engine: 'validate', source: { schema: SCHEMA }, data: { data: '{}' }, config: { locale: 'nl' } }, 'opened');
      assert.equal(play.read().locale, null, 'an opened session sets no language');
      assert.equal(withPlayLocale(play.read()).config.locale, 'en');
    } finally { play.dispose(); }
  });

  it('shows an example made for one language in it, and leaves the reader\'s language alone', () => {
    const play = mount();
    try {
      choose(play, 'de');
      play.dispatch('play/example', 'validate-locale-fr');
      assert.equal(play.read().locale, 'de', "the reader's language is still theirs");
      assert.equal(withPlayLocale(play.read()).config.locale, 'fr', 'the example runs in its own language');
      play.dispatch('play/example', 'validate-invalid');
      assert.equal(withPlayLocale(play.read()).config.locale, 'de', 'the next example runs in the reader\'s again');
      play.dispatch('play/example', 'validate-locale-fr');
      choose(play, 'ja');
      assert.equal(play.read().locale, 'ja');
      assert.equal(withPlayLocale(play.read()).config.locale, 'ja', "the reader's choice replaces the example's language");
    } finally { play.dispose(); }
  });

  it("names the form's buttons and JSON hint in the chosen language", () => {
    assert.equal(formLabelsFor('de')?.addItem, 'Element hinzufügen');
    assert.equal(formLabelsFor()?.addItem, 'Add item');
    assert.equal(formLabelsFor('xx')?.addItem, 'Add item', 'an unknown locale falls back to English');
  });
});
