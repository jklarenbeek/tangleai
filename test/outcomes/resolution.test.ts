import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeRevision } from '@tangleai/outcomes';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import { fixture, id, code, value, AT, LATER, LATE, scopeId } from './fixtures.ts';

describe('independent outcome evidence', () => {
  it('freezes decision output, validates its chronology and forbids scope or adapter substitution', async () => {
    const f = await fixture();
    const decisionId = id(await f.create('one'), 'decisionId');
    assert.deepEqual((await f.inspect(decisionId)).output, { predicted: 0 });
    code(await f.create('bad', { cutoffAt: LATER }), 'OUTC1001');
    code(await f.create('adapter', { adapter: { ...f.adapter.identity, revision: 'a'.repeat(64) } }), 'OUTC1008');
    code(await f.service.inspect({ scopeId: 'b'.repeat(64), artifactKey: 'a', input: { id: decisionId } }), 'OUTC1003');
    code(await f.create('missing', { output: {} }), 'OUTC1001');
    code(await f.create('one', { output: { predicted: 1 } }), 'OUTC1007');
  });
  it('replays stored verified evidence after its original source disappears, with no reads or writes', async () => {
    const f = await fixture(), r = await f.resolved('one');
    const original = await f.inspect(r.resolutionId), reads = f.reads(); f.sources.clear();
    const before = await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId }));
    const replay = await f.service.resolve(r.resolutionCommand); assert.ok(replay.ok); assert.equal(replay.writes, 0); assert.equal(replay.replayed, true);
    assert.equal(id(replay, 'resolutionId'), r.resolutionId); assert.equal(f.reads(), reads); assert.deepEqual(await f.inspect(r.resolutionId), original);
    assert.deepEqual(await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId })), before);
    code(await f.service.resolve({ ...r.resolutionCommand, requestKey: 'second', at: LATE }), 'OUTC1007');
    assert.equal(f.reads(), reads);
  });
  it('pins late arrival separately from observation, and reports an unknown deadline as null', async () => {
    for (const expectedResolutionAt of [LATER, null]) {
      const f = await fixture(), decisionId = id(await f.create('one', { expectedResolutionAt }), 'decisionId'), ref = await f.evidence(decisionId);
      const resolutionId = id(await f.service.resolve(f.command('resolve', { decisionId, evidence: [ref], receivedAt: LATE }, LATE)), 'resolutionId');
      const r = await f.inspect(resolutionId); assert.equal(r.late, expectedResolutionAt === null ? null : true); assert.equal(r.receivedAt, LATE);
      assert.equal((r.sources as Array<Record<string, unknown>>)[0].observedAt, LATER);
    }
  });
  for (const kind of ['missing', 'mutable', 'scope', 'subject', 'question', 'early', 'future'] as const) it(`refuses ${kind} evidence before accepting truth`, async () => {
    const f = await fixture(), decisionId = id(await f.create('one'), 'decisionId');
    const changes = kind === 'scope' ? { scopeId: 'a'.repeat(64) } : kind === 'subject' ? { subject: 'another' } : kind === 'question' ? { decisionId: 'a'.repeat(64) } : kind === 'early' ? { observedAt: '2025-01-01T00:00:00.000Z' } : kind === 'future' ? { observedAt: LATE } : {};
    const ref = await f.evidence(decisionId, changes);
    if (kind === 'missing') f.sources.clear();
    if (kind === 'mutable') f.sources.get(ref.sourceId)!.payload = { actual: 1 };
    const result = await f.service.resolve(f.command('r', { decisionId, evidence: [ref], receivedAt: LATER }));
    code(result, ['scope', 'subject', 'question'].includes(kind) ? 'OUTC1003' : 'OUTC1006');
    const records = await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId, kind: 'resolution' })); assert.equal(records.length, 0);
  });
  it('a new conflicting truth is refused and the original resolution survives', async () => {
    const f = await fixture(), r = await f.resolved('one'), ref = await f.evidence(r.decisionId, { payload: { actual: 1 } });
    const c = f.command('conflict', { decisionId: r.decisionId, evidence: [ref], receivedAt: LATER });
    code(await f.service.resolve(c), 'OUTC1007'); const count = (await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId }))).length;
    code(await f.service.resolve(c), 'OUTC1007'); assert.equal((await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId }))).length, count);
    assert.deepEqual((await f.inspect(r.resolutionId)).payload, { actual: 0 });
  });
});
