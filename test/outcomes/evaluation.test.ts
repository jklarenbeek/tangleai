import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeRevision, createOutcomeService } from '@tangleai/outcomes';
import { lifecycleFixture } from './guarded-fixtures.ts';
import { code, id, value, scopeId, scope } from './fixtures.ts';

describe('independent held-out outcome eligibility', () => {
  it('accepts beneficial generalization and retains a failed held-out case beside its wins', async () => {
    const f = await lifecycleFixture(), s = await f.stage(), e = await f.evaluate(s.versionId);
    assert.equal(value(e.result).eligible, true); const record = await f.inspect(e.evaluationId);
    assert.equal(record.meanDelta, .75); assert.equal((record.caseResults as Array<{ category: string }>).filter(c => c.category === 'failure').length, 1);
    const reads = f.deliveries(); const again = await f.service.evaluate(e.command); assert.ok(again.ok && again.replayed); assert.equal(again.writes, 0); assert.equal(f.deliveries(), reads);
    code(await f.service.evaluate({ ...e.command, requestKey: 'new-key' }), 'OUTC1007');
  });
  it('refuses a tied candidate and never changes the active head', async () => {
    const f = await lifecycleFixture(), s = await f.stage('tie', { payload: f.adapter.staticPayload }), e = await f.evaluate(s.versionId);
    assert.equal(value(e.result).eligible, false);
    code(await f.service.approve(f.command('a', { action: 'promote', versionId: s.versionId, evaluationId: e.evaluationId, expectedHead: { versionId: null, revision: 0 }, reason: 'tie' })), 'OUTC1011');
  });
  it('cannot use a consumed slot for a second candidate or rename its held-out content', async () => {
    const f = await lifecycleFixture(), a = await f.stage('a'), b = await f.stage('b'); await f.evaluate(a.versionId);
    await f.register(b.versionId); code(await f.service.evaluate(f.command('same-slot', { versionId: b.versionId, slotId: 'slot' })), 'OUTC1011');
    const c = await f.stage('c'), original = f.slots.get('slot')!;
    await f.register(c.versionId, 'renamed', { cases: original.cases.map(c => ({ ...c, id: 'renamed:' + c.id })) });
    code(await f.service.evaluate(f.command('renamed-slot', { versionId: c.versionId, slotId: 'renamed' })), 'OUTC1011');
  });
  it('rejects overlap with training even when a held-out case has a different id', async () => {
    const f = await lifecycleFixture(), s = await f.stage(), slot = await f.register(s.versionId);
    const c = slot.cases[0]; c.input = { token: 'training:one' }; const { digest, ...data } = c.source;
    c.source = { ...data, payload: { label: 'yes' }, digest: await outcomeRevision({ ...data, payload: { label: 'yes' } }) }; f.sources.set(c.source.sourceId, c.source);
    code(await f.service.evaluate(f.command('overlap', { versionId: s.versionId, slotId: slot.slotId })), 'OUTC1011');
  });
  it('one failed case cannot shrink the denominator into eligibility', async () => {
    const f = await lifecycleFixture(), s = await f.stage(), slot = await f.register(s.versionId); slot.cases[0].input = { token: '' };
    const e = await f.service.evaluate(f.command('bad-case', { versionId: s.versionId, slotId: slot.slotId })); assert.equal(value(e).eligible, false);
    const record = await f.inspect(id(e, 'evaluationId')); assert.equal(record.meanDelta, null); assert.equal((record.caseResults as unknown[]).length, 3);
  });
  it('a schema or bound policy change cannot reset an existing lineage', async () => {
    const f = await lifecycleFixture(); await f.stage();
    const changed = await createOutcomeService({ ...f.host, policy: { maxVersions: 20, maxPayloadBytes: 32768, maxOperations: 32, maxChangedLeaves: 32, maxReflectionBytes: 8192 } });
    code(await changed.reflect(f.command('changed-policy', f.input())), 'OUTC1008');
  });
});
