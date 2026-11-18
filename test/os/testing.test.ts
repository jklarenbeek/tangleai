/**
 * The desktop for an application's own CI: `checkSuite` says what keeps a
 * suite from joining and what will not work, and `createTestDesktop` runs the
 * suite headless as a person's link would join it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkSuite, createTestDesktop } from '@tangleai/os/testing';

const RECORDS = { $contract: '0.1', id: 'records', operations: { 'records.search': { kind: 'read', input: { type: 'object' }, output: { type: 'array' } } } };
const app = (id: string, extra: Record<string, unknown> = {}) => ({ $module: '0.1', id, version: '1.0.0', title: { en: id }, host: { kind: 'origin', url: `https://${id}.example/app` }, ...extra });
const SUITE = { $suite: '0.1' as const, id: 'shop-suite', modules: [app('catalogue', { provides: [RECORDS], proposals: [{ kind: 'stock.reorder', title: { en: 'Reorder' } }] }), app('labels', { requires: [{ contract: 'records', operations: ['records.search'] }] })] };

describe('checking a suite', () => {
  it('passes a suite that will join', () => {
    assert.deepEqual(checkSuite(SUITE, { desktopOrigin: 'https://desk.example' }), []);
  });

  it('names every reason one will not', () => {
    assert.equal(checkSuite({ modules: [] })[0].code, 'OS0150');
    const issues = checkSuite({
      $suite: '0.1', id: 'Bad Id',
      modules: [app('one', { provides: [RECORDS] }), app('one'), app('two', { provides: [RECORDS] }), app('shell'), { $module: '0.1', id: 'broken' }, app('own', { host: { kind: 'origin', url: 'https://desk.example/own' } }), app('needs', { requires: [{ contract: 'mail_out' }] })],
    }, { desktopOrigin: 'https://desk.example' });
    const codes = issues.map(i => `${i.level} ${i.code} ${i.path}`);
    assert.ok(codes.includes('error OS0150 /id'));
    assert.ok(codes.includes('error OS0151 /modules/1/id'), 'an id twice');
    assert.ok(codes.includes('error OS0011 /modules/2/provides/0/id'), 'a contract twice');
    assert.ok(codes.includes('error OS0012 /modules/3/id'), 'a reserved id');
    assert.ok(codes.some(c => c.startsWith('error') && c.includes('/modules/4')), 'an invalid manifest');
    assert.ok(codes.includes('error OS0201 /modules/5/host/url'), 'the desktop\'s own origin');
    assert.ok(codes.includes('warning OS0152 /modules/6/requires/0'), 'a contract nothing provides');
    assert.deepEqual(checkSuite(SUITE, { capabilities: [] }).map(i => i.code), [], 'capabilities agree when none are named');
  });
});

describe('a test desktop', () => {
  it('joins the suite with consent, serves its contracts and keeps the assistant to what was allowed', async () => {
    const desk = await createTestDesktop({
      suite: SUITE,
      consent: { labels: { assistant: false } },
      serve: { records: { 'records.search': () => [{ id: 'r1' }] } },
    });
    assert.deepEqual(desk.joined, ['catalogue', 'labels']);
    assert.deepEqual(await desk.call('labels', 'records', 'records.search'), { ok: true, value: [{ id: 'r1' }] }, 'what labels asked for, granted');
    assert.deepEqual(await desk.assistant.call('records', 'records.search'), { ok: true, value: [{ id: 'r1' }] }, 'catalogue let the assistant in');
    assert.ok(desk.assistant.operations().some(o => o.contract === 'records'));
    assert.equal((desk.state().find(d => d.key === 'apps')?.value as any).apps.length, 2, 'kept as the person\'s state would keep them');

    const narrow = await createTestDesktop({ suite: SUITE, consent: { labels: { scopes: [] }, catalogue: { assistant: false } }, serve: { records: { 'records.search': () => [] } } });
    assert.equal((await narrow.call('labels', 'records', 'records.search')).ok, false);
    assert.equal((await narrow.assistant.call('records', 'records.search')).ok, false);
  });

  it('files a proposal and carries the person\'s decision to the application', async () => {
    const desk = await createTestDesktop({ suite: SUITE });
    desk.onDecision('catalogue');
    const filed = desk.propose('catalogue', { id: 'p1', kind: 'stock.reorder', title: 'Reorder oak' });
    assert.equal(filed.ok, true);
    const mail = desk.mail().find(m => m.proposal?.id === 'p1')!;
    assert.equal((await desk.decide(mail.id, 'accept')).ok, true);
    assert.deepEqual(desk.decisions().map(d => [d.module, d.decision.id, d.decision.decision]), [['catalogue', 'p1', 'accept']]);
  });

  it('refuses a serve for a contract nothing provides', async () => {
    await assert.rejects(createTestDesktop({ suite: SUITE, serve: { nothing: {} } }), /no joined application provides 'nothing'/);
  });
});
