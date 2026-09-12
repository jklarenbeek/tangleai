import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import { fixture, id, code } from './fixtures.ts';

describe('pinned deterministic outcome scorers', () => {
  it('matches all seven independent numeric goldens, including the strict boundary and negative zero', async () => {
    const a = await createDirectionDeltaAdapter();
    const cases = [[0, 0, 'success'], [0, 0.049, 'success'], [0, 0.05, 'partial'], [0, 0.051, 'partial'], [-0.1, -0.12, 'success'], [-0.1, 0.1, 'failure'], [0, -0.01, 'failure']] as const;
    for (const [predicted, actual, expected] of cases) assert.equal(a.score({ predicted }, { actual }).outcome, expected);
    assert.equal(a.score({ predicted: -0 }, { actual: 0 }).outcome, 'success');
    for (const predicted of [null, '0', NaN, Infinity, -Infinity]) assert.throws(() => a.score({ predicted }, { actual: 0 }), /finite JSON|schema/);
    assert.throws(() => a.score({}, { actual: 0 }), /schema/);
    assert.throws(() => a.interpret({ base: Number.MAX_VALUE }, { offset: Number.MAX_VALUE }), /finite/);
  });
  it('normalizes prefix order by Unicode code points and scores labels exactly', async () => {
    const a = await createExactMatchAdapter();
    const payload = { fallbackLabel: 'no', rules: [{ prefix: 'a', label: 'short' }, { prefix: 'accept:', label: 'yes' }, { prefix: '😀', label: 'emoji' }] };
    assert.deepEqual(a.interpret({ token: 'accept:new-heldout-token' }, payload), { label: 'yes' });
    assert.deepEqual(a.interpret({ token: 'reject:one' }, payload), { label: 'no' });
    assert.equal(a.score({ label: 'Yes' }, { label: 'yes' }).outcome, 'failure');
    assert.equal(a.score({ label: 'é' }, { label: 'é' }).outcome, 'failure');
    assert.deepEqual(a.normalizePayload!(payload), a.normalizePayload!({ ...payload, rules: [...payload.rules].reverse() }));
    assert.throws(() => a.interpret({ token: 'a' }, { ...payload, rules: [payload.rules[0], payload.rules[0]] }), /unique/);
  });
  it('a scorer failure preserves resolution and leaves the same request explicitly retryable', async () => {
    const adapter = await createDirectionDeltaAdapter(); let fail = true;
    const f = await fixture({ adapter: { ...adapter, score(output, resolution) { if (fail) throw Error('private detail'); return adapter.score(output, resolution); } } });
    const r = await f.resolved('one'), c = f.command('s', { resolutionId: r.resolutionId });
    const failed = await f.service.score(c); code(failed, 'OUTC1015'); assert.ok(!failed.ok && failed.issues[0].retryable); assert.ok(!JSON.stringify(failed).includes('private detail'));
    assert.equal((await f.inspect(r.resolutionId)).kind, 'resolution'); fail = false;
    const scoreId = id(await f.service.score(c), 'scoreId'), reads = f.reads();
    const again = await f.service.score(c); assert.ok(again.ok); assert.equal(again.writes, 0); assert.equal(id(again, 'scoreId'), scoreId); assert.equal(f.reads(), reads);
    code(await f.service.score({ ...c, requestKey: 's2' }), 'OUTC1007');
  });
});
