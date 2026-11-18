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

describe('the desktop\'s apps contract', () => {
  const BILL = { $app: '0.1', state: { amount: 0 }, view: { $jslt: '0.1', rules: [{ match: '$', body: ['div', {},
    ['label', {}, 'Bill amount', ['input', { type: 'number', on: { input: 'amount' } }]], ['p', {}, 'Total: ', '$.amount']] }] },
    actions: { amount: { patch: [{ op: 'replace', path: '/amount', value: { $number: '$event.value' } }] } } };

  it('gives the assistant the crib and a check, and offers a finished application in the inbox, never on the desktop', async () => {
    const { createKernel, memoryStore } = await import('@tangleai/os');
    const kernel = createKernel({ assistantGrants: 'all', state: memoryStore() });
    await kernel.ready();
    assert.ok(kernel.operations().some(o => o.tool === 'tangle_os_apps__apps_suggest'));
    const crib: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.crib', {});
    assert.match(crib.value.crib, /\$app/);
    const check: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.check', { doc: BILL, probes: [{ steps: [{ find: { role: 'field', name: 'amount' }, type: '12' }], expect: { text: ['Total: 12'] } }] });
    assert.deepEqual(check.value, { ok: true, problems: [], shown: check.value.shown });

    const broken: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.suggest', { title: 'Broken', doc: { $app: '0.1', state: {}, view: { $jslt: '0.1', rules: [{ match: '$', body: ['p', {}, '${x}'] }] } } });
    assert.equal(broken.error.code, 'OS0160');

    const offered: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.suggest', { title: 'Bill splitter', summary: 'Splits a bill.', doc: BILL });
    assert.equal(offered.ok, true);
    assert.equal(kernel.modules().some(m => m.id.startsWith('my-')), false, 'nothing is added until the person accepts');
    const mail = kernel.mail().find(m => m.proposal?.kind === 'app.add')!;
    assert.equal(mail.from, 'desktop');
    // the assistant cannot decide: deciding is the person's, through the shell
    assert.equal(kernel.operations().some(o => /decide/.test(o.op)), false);

    const decided: any = await kernel.decide(mail.id, 'accept');
    assert.equal(decided.value.module, 'my-bill-splitter');
    const added = kernel.effective('my-bill-splitter')!;
    assert.equal(added.host.kind, 'document');
    assert.deepEqual(kernel.grants()['my-bill-splitter'], []);
    assert.deepEqual(kernel.consentOf('my-bill-splitter')?.scopes, []);
    assert.equal(kernel.layerOf('my-bill-splitter'), 'user');
    // a second application of the same name gets its own id
    await kernel.call('assistant', 'tangle_os_apps', 'apps.suggest', { title: 'Bill splitter', doc: BILL });
    const again = kernel.mail().filter(m => m.proposal?.kind === 'app.add').at(-1)!;
    assert.equal(((await kernel.decide(again.id, 'accept')) as any).value.module, 'my-bill-splitter-2');
  });
});

describe('changing an application written for the person', () => {
  const app = (total: string) => ({ $app: '0.1', state: { n: 0 }, view: { $jslt: '0.1', rules: [{ match: '$', body: ['p', {}, total, '$.n'] }] } });

  it('reads it with a revision, offers a new version in the inbox, and refuses one written against an older revision', async () => {
    const { createKernel, memoryStore } = await import('@tangleai/os');
    const kernel = createKernel({ assistantGrants: 'all', state: memoryStore() });
    await kernel.ready();
    await kernel.call('assistant', 'tangle_os_apps', 'apps.suggest', { title: 'Counter', doc: app('Count: ') });
    await kernel.decide(kernel.mail().at(-1)!.id, 'accept');
    const list: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.read', {});
    assert.deepEqual(list.value.applications, [{ module: 'my-counter', title: 'Counter' }]);
    const read: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.read', { module: 'my-counter' });
    assert.equal(read.value.doc.view.rules[0].body[2], 'Count: ');

    // a host's own module is never the assistant's to change
    kernel.install({ $module: '0.1', id: 'notes', version: '1.0.0', title: { en: 'Notes' }, host: { kind: 'document', app: app('x') } }, 'shipped');
    assert.equal(((await kernel.call('assistant', 'tangle_os_apps', 'apps.read', { module: 'notes' })) as any).error.code, 'OS0161');

    const revised: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.revise', { module: 'my-counter', revision: read.value.revision, summary: 'Says "Total".', doc: app('Total: ') });
    assert.equal(revised.ok, true);
    assert.equal(kernel.effective('my-counter')!.host.kind === 'document' && (kernel.effective('my-counter')!.host as any).app.view.rules[0].body[2], 'Count: ', 'nothing changes until the person accepts');
    // a second version written against the same, now older, revision is refused once the first is accepted
    const offer = kernel.mail().find(m => m.proposal?.kind === 'app.revise')!;
    const accepted: any = await kernel.decide(offer.id, 'accept');
    assert.deepEqual(accepted.value, { status: 'accepted', module: 'my-counter', revised: true });
    assert.equal((kernel.effective('my-counter')!.host as any).app.view.rules[0].body[2], 'Total: ');
    assert.deepEqual(kernel.grants()['my-counter'], [], 'the new version asks for nothing either');
    const stale: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.revise', { module: 'my-counter', revision: read.value.revision, doc: app('Sum: ') });
    assert.equal(stale.error.code, 'OS0112');

    // and one that went stale while it waited in the inbox stays pending with the reason
    const now: any = await kernel.call('assistant', 'tangle_os_apps', 'apps.read', { module: 'my-counter' });
    await kernel.call('assistant', 'tangle_os_apps', 'apps.revise', { module: 'my-counter', revision: now.value.revision, doc: app('Sum: ') });
    const waiting = kernel.mail().find(m => m.proposal?.kind === 'app.revise' && m.proposal.status === 'pending')!;
    const other = { ...kernel.effective('my-counter')!, host: { kind: 'document', app: app('Elsewhere: ') } };
    kernel.join(other, { scopes: [], assistant: false, source: 'assistant:assistant' });
    const late: any = await kernel.decide(waiting.id, 'accept');
    assert.equal(late.error.code, 'OS0112');
    assert.equal(kernel.mail().find(m => m.id === waiting.id)!.proposal!.status, 'pending');
  });
});
