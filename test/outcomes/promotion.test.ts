import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryOutcomeStore, createOutcomeService } from '@tangleai/outcomes';
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import { lifecycleFixture } from './guarded-fixtures.ts';
import { code, id, value, scopeId, revision } from './fixtures.ts';
import { persistenceFor } from '../../packages/outcomes/src/store.ts';
import type { Head } from '@tangleai/outcomes';

describe('explicit checked artifact activation', () => {
  for (const sqlite of [false, true]) it(`${sqlite ? 'SQLite' : 'reference'} admits exactly one of twenty separately approved contenders`, async () => {
    const db = sqlite ? await openTangleDb() : null;
    try {
      const f = await lifecycleFixture({ store: db ? createOutcomeStore(db) : createMemoryOutcomeStore() }), s = await f.stage(), e = await f.evaluate(s.versionId);
      const approvals = [];
      for (let i = 0; i < 20; i++) approvals.push(await f.approve(s.versionId, e.evaluationId, { versionId: null, revision: 0 }, 'approval:' + i));
      assert.equal(new Set(approvals.map(a => a.approvalId)).size, 20);
      const results = await Promise.all(approvals.map((a, i) => f.service.promote(f.command('promote:' + i, { approvalId: a.approvalId }))));
      assert.equal(results.filter(r => r.ok).length, 1); results.filter(r => !r.ok).forEach(r => code(r, 'OUTC1013'));
      const checked = value(await f.service.injectChecked({ scopeId, artifactKey: 'a', input: {} })); assert.deepEqual(checked.head, { versionId: s.versionId, revision: 1 });
    } finally { await db?.close(); }
  });
  it('requires an out-of-band principal before approval, including replay of another principal receipt', async () => {
    const f = await lifecycleFixture(), root = await f.root();
    const untrusted = await createOutcomeService({ ...f.host, principal: { id: 'model', authorityId: revision, approve: false, reconcile: false } });
    code(await untrusted.approve(root.command), 'OUTC1012');
    code(await untrusted.approve({ ...root.command, input: { ...root.command.input, actorId: 'operator' } }), 'OUTC1001');
  });
  it('evolves, restores a previously active version, and fences the old head after A→B→A', async () => {
    const f = await lifecycleFixture(), root = await f.root();
    const child = await f.stage('child', { mode: 'evolve', parentVersionId: root.versionId, payload: null, patch: [{ op: 'replace', path: '/fallbackLabel', value: 'no' }] });
    const evaluated = await f.evaluate(child.versionId, 'child-held'); const approval = await f.approve(child.versionId, evaluated.evaluationId, root.head, 'approve-child');
    const stale = await f.approve(child.versionId, evaluated.evaluationId, root.head, 'stale-child');
    const activated = value(await f.service.promote(f.command('promote-child', { approvalId: approval.approvalId })));
    const rollback = await f.approve(root.versionId, root.evaluationId, activated.head as unknown as Head, 'approve-rollback', 'rollback');
    code(await f.service.rollback(f.command('wrong-action', { approvalId: root.approvalId })), 'OUTC1012');
    value(await f.service.rollback(f.command('rollback', { approvalId: rollback.approvalId })));
    const head = value(await f.service.injectChecked({ scopeId, artifactKey: 'a', input: {} })).head;
    assert.deepEqual(head, { versionId: root.versionId, revision: 3 });
    code(await f.service.promote(f.command('stale', { approvalId: stale.approvalId })), 'OUTC1013');
    const replay = await f.service.promote(root.activationCommand); assert.ok(replay.ok && replay.replayed); assert.equal(replay.writes, 0); assert.deepEqual(value(replay).head, root.head);
    assert.equal((await f.inspect(child.versionId)).kind, 'artifactVersion');
  });
  for (const sqlite of [false, true]) for (const fault of ['put:heads', 'put:keys', 'put:records', 'commit']) it(`${sqlite ? 'SQLite' : 'reference'} rolls back activation failure at ${fault}`, async () => {
    let armed = false, seenHead = false;
    const probe = (step: string) => { if (!armed) return; if (step === 'put:heads') seenHead = true; if (step === fault && (fault === 'put:records' || seenHead)) { armed = false; throw Error('activation fault'); } };
    const db = sqlite ? await openTangleDb() : null;
    try {
      const f = await lifecycleFixture({ store: db ? createOutcomeStore(db, { applyProbe: probe }) : createMemoryOutcomeStore({ applyProbe: probe }) });
      const s = await f.stage(), e = await f.evaluate(s.versionId), a = await f.approve(s.versionId, e.evaluationId, { versionId: null, revision: 0 }); armed = true;
      const c = f.command('promote', { approvalId: a.approvalId }); code(await f.service.promote(c), 'OUTC1015');
      code(await f.service.injectChecked({ scopeId, artifactKey: 'a', input: {} }), 'OUTC1004');
      assert.equal((await persistenceFor(f.store).transaction(tx => tx.query('records', { scopeId, kind: 'activationEvent' }))).length, 0);
      value(await f.service.promote(c)); assert.deepEqual(value(await f.service.injectChecked({ scopeId, artifactKey: 'a', input: {} })).head, { versionId: s.versionId, revision: 1 });
    } finally { await db?.close(); }
  });
});
