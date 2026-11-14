/**
 * The Pages playground hosts `@jarenjs/play` as the upstream site does: an
 * option switch brings the source its new choice runs (`switchOption`), a
 * number field reads what a browser's number input hands over
 * (`FORM_NUMBER_VALUE`), the validate engine registers the referenced
 * schemas Play passes it, and a foreign session or query input lands as
 * safe defaults instead of reaching the engines.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mountPlay } from '../../apps/pages/src/demos/playground/mount-play.ts';
import { legacyExperimentToSession, sessionToLoaded } from '../../apps/pages/src/demos/playground/play.ts';
import { runQuery } from '../../apps/pages/src/demos/playground/engines.ts';
import { createStubHost } from '../assistant/dom.stub.ts';

function mount() {
  const { container } = createStubHost();
  return mountPlay(container as any, { debounceMs: 0, schedule: (f: any) => f(), onError: (error: any) => { throw error; } });
}
const option = (play: any, key: string, value: string) => play.dispatch('play/option', { key }, { target: { value }, type: 'change' });
const panels = (play: any) => play.read().result.panels;

const ADDRESS = { $id: 'https://example.com/address.json', type: 'object', properties: { city: { type: 'string', minLength: 2 } }, required: ['city'] };
const ORDER = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { billing: { $ref: 'https://example.com/address.json' } } };

describe('the playground hosts Play as the upstream site does', () => {
  it('converts the source when a converting option changes, and follows an example when the option names one', () => {
    const play = mount();
    try {
      play.dispatch('play/example', 'charts-pie');
      const json = play.read().source;
      option(play, 'format', 'josl');
      assert.equal(play.read().config.format, 'josl');
      assert.notDeepEqual(play.read().source, json, 'the chart definition is re-expressed for the new format');
      assert.equal(play.read().result.ok, true, 'the converted source runs');

      play.dispatch('play/example', 'kernel-distance');
      option(play, 'kernel', 'addDuration');
      assert.equal(play.read().exampleId, 'kernel-add-duration', "the kernel's own example is loaded");
      assert.equal(play.read().config.kernel, 'addDuration');
      assert.equal(play.read().result.ok, true, 'and runs');
      option(play, 'locale', 'de');
      assert.equal(play.read().locale, 'de', 'a language choice still becomes the reader\'s');
    } finally { play.dispose(); }
  });

  it('reads a number field as a browser number input hands it over', () => {
    const play = mount();
    try {
      play.dispatch('play/example', 'validate-user');
      play.dispatch('play/data-view', 'form');
      assert.equal(play.read().dataView, 'form');
      for (const [text, value] of [['.5', 0.5], ['-.5', -0.5], ['01', 1], ['5', 5], ['', null], ['1e3', 1000]] as const) {
        play.dispatch('play/f-number', { pointer: '/age' }, { target: { value: text }, type: 'input' });
        assert.equal(play.read().dataValue.age, value, `'${text}'`);
      }
    } finally { play.dispose(); }
  });

  it('registers the referenced schemas a $ref names, and reports a broken one at its pane', () => {
    const play = mount();
    try {
      play.replace({ engine: 'validate', source: { schema: JSON.stringify(ORDER), schemas: JSON.stringify([ADDRESS]) }, data: { data: JSON.stringify({ billing: { city: 'A' } }) } });
      assert.equal(play.read().result.ok, true, JSON.stringify(play.read().result.error));
      const errors = panels(play).find((panel: any) => panel.id === 'errors');
      assert.deepEqual(errors?.rows.map(([path]: any) => path), ['/billing/city']);

      play.replace({ engine: 'validate', source: { schema: JSON.stringify(ORDER), schemas: JSON.stringify([{ ...ADDRESS, type: 7 }]) }, data: { data: '{}' } });
      assert.equal(play.read().result.ok, false);
      assert.equal(play.read().result.error.pane, 'schemas');
    } finally { play.dispose(); }
  });

  it('lands a foreign session, engine name or externals input as safe defaults', () => {
    assert.deepEqual(sessionToLoaded({ engine: 'validate', source: ['x'], data: [1], config: [2] }),
      { engine: 'validate', exampleId: null, source: {}, data: {}, config: {} });
    assert.equal(legacyExperimentToSession('constructor', { a: 'b' }), null);
    assert.equal(legacyExperimentToSession('toString', {}), null);
    const nodes = runQuery({ query: '"$x"', data: '{}', externals: '[1]' });
    assert.match(JSON.stringify(nodes), /Externals must be an object/);
    const inherited = runQuery({ query: '"$toString"', data: '{}', externals: '{}' });
    assert.match(JSON.stringify(inherited), /Unbound externals/, 'an inherited name is not a bound external');
  });
});
