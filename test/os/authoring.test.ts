/**
 * The authoring gate, model-free: the crib's seed works and passes a probe a
 * person would run, every operator the crib names is Jaren's, documents that
 * look right but do not work are refused with what to fix, and an authored
 * module asks for nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '@jarenjs/app';
import { AUTHORING_OPERATORS, AUTHORING_SEED, authoringCrib, authoredManifest, checkAuthoredApp, lintAuthoredApp } from '@tangleai/os/authoring';
import { validateManifest } from '@tangleai/os';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('the authoring crib', () => {
  it('names only operators Jaren compiles, and carries the working seed', () => {
    for (const op of AUTHORING_OPERATORS) {
      const doc = { $app: '0.1', state: { a: 1, xs: [1, 2] }, view: { $jslt: '0.1', rules: [{ match: '$', body: ['p', {}, 'x'] }] }, actions: { go: { patch: [{ op: 'replace', path: '/a', value: { [op]: ['$.a', 1] } }] } } };
      try { createApp(doc as any); }
      catch (error: any) { assert.doesNotMatch(String(error.message), /unknown operator/, `${op} is not Jaren's`); }
    }
    const crib = authoringCrib();
    assert.ok(crib.includes(JSON.stringify(AUTHORING_SEED)));
    assert.ok(!crib.includes('$lower-case'));
  });
});

describe('the authoring gate', () => {
  const ADD = { steps: [{ find: { role: 'field' as const, name: 'new item' }, type: 'Buy milk' }, { find: { role: 'button' as const, name: '^\\s*add' } }], expect: { text: ['Buy milk', '2 open of 3'] } };

  it('passes the seed used as a person would use it, found by its words', async () => {
    const verdict = await checkAuthoredApp(clone(AUTHORING_SEED), [ADD, { steps: [{ find: { role: 'checkbox', nth: 1 } }], expect: { text: ['0 open of 2'] } }]);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.ok, true);
  });

  it('says what is wrong when it does not work', async () => {
    const broken = clone(AUTHORING_SEED) as any;
    // a slip a model makes: the action clears the draft but never adds the item
    broken.actions.add = { patch: [{ op: 'replace', path: '/draft', value: '' }] };
    const verdict = await checkAuthoredApp(broken, [ADD]);
    assert.equal(verdict.ok, false);
    assert.match(verdict.problems[0], /should show "Buy milk"/);

    const unknown = clone(AUTHORING_SEED) as any;
    unknown.actions.draft = { patch: [{ op: 'replace', path: '/draft', value: { '$lower-case': '$event.value' } }] };
    assert.match((await checkAuthoredApp(unknown)).problems.join(' '), /unknown operator '\$lower-case' \(did you mean '\$lower'\?\)/);

    const nothing = await checkAuthoredApp(clone(AUTHORING_SEED), [{ steps: [{ find: { role: 'button', name: 'export' } }], expect: {} }]);
    assert.match(nothing.problems[0], /no button named like \/export\//);
    assert.equal((await checkAuthoredApp({ view: [] })).ok, false);
  });

  it('finds a field by a separate label, and reports a first frame that fails', async () => {
    const doc = { $app: '0.1', state: { km: 0 }, view: { $jslt: '0.1', rules: [{ match: '$', body: ['div', {},
      ['label', { for: 'km' }, 'Distance in kilometres'], ['input', { id: 'km', type: 'number', on: { input: 'set' } }],
      ['p', {}, { $round: [{ $div: ['$.km', 1.609344] }, 2] }, ' miles']] }] },
      actions: { set: { patch: [{ op: 'replace', path: '/km', value: { $number: '$event.value' } }] } } };
    assert.equal((await checkAuthoredApp(doc, [{ steps: [{ find: { role: 'field', name: 'kilomet' }, type: '10' }], expect: { text: ['6.21 miles'] } }])).ok, true);
    const fails = { $app: '0.1', state: { t: 'abc' }, view: { $jslt: '0.1', rules: [{ match: '$', body: ['p', {}, { $length: '$.t' }] }] } };
    assert.match((await checkAuthoredApp(fails)).problems[0], /first frame fails/);
  });

  it('refuses code written in strings and object-shaped vnodes', () => {
    const doc = { $app: '0.1', state: {}, view: { $jslt: '0.1', rules: [{ match: '$', body: ['p', {}, '${total}', { type: 'div', children: [] }] }] } };
    assert.equal(lintAuthoredApp(doc).length, 2);
  });
});

describe('an authored module', () => {
  it('is a document module that asks for nothing and offers nothing', () => {
    const manifest = authoredManifest(clone(AUTHORING_SEED), { id: 'my-todo', title: { en: 'My to-do', nl: 'Mijn taken' } });
    const verdict = validateManifest(manifest);
    assert.equal(verdict.ok, true);
    for (const member of ['requires', 'provides', 'capabilities', 'files', 'opens', 'settings', 'proposals']) assert.equal((manifest as any)[member], undefined, member);
    assert.equal(manifest.host.kind, 'document');
  });
});
