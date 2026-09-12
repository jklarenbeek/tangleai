import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import { createOutcomeService, outcomeRevision } from '@tangleai/outcomes';
import { safetyFixture } from '../../benchmark/lib/outcome-scenarios.ts';
import { createInterruptedProposer } from '../../benchmark/lib/outcome-model-fixture.ts';
import { resultId, resultValue } from '../../benchmark/lib/outcome-runtime.ts';
import { code } from './fixtures.ts';
import type { HistoryPage } from '@tangleai/outcomes';

for (const stage of ['dispatch', 'score', 'promotion']) it(`new process recovers persisted ${stage} interruption without repeating a committed effect`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'outcome-interrupt-')), path = join(dir, 'db');
  try {
    const child = spawnSync(process.execPath, ['test/outcomes/interruption-worker.ts', path, stage], { encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 17, child.stderr);
    const db = await openTangleDb({ path });
    try {
      const f = await safetyFixture(false, createOutcomeStore(db));
      if (stage === 'dispatch') {
        let calls = 0; const proposer = await createInterruptedProposer(() => { calls++; throw Error('Must not redispatch'); });
        const service = await createOutcomeService({ ...f.host, proposer });
        const command = f.command('uncertain', { ...f.reflectInput(null), text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } });
        code(await service.reflect(command), 'OUTC1017'); assert.equal(calls, 0);
        const history = resultValue(await service.history(f.query({ pageSize: 200 }))) as unknown as HistoryPage;
        const event = history.entries.map(e => e.record).find(r => r.kind === 'attemptEvent' && r.stage === 'dispatched'); assert.ok(event && event.kind === 'attemptEvent');
        const attempt = (event.details as { attempt: number }).attempt;
        const payload = { kind: 'no-dispatch', attemptId: event.requestId, attempt, inputDigest: event.inputDigest, reason: 'The fixture exited after the dispatch receipt and before its wire.' };
        const evidence = await f.source(null, 'no-dispatch', payload);
        const reconcile = await service.reconcile(f.command('reconcile', { attemptId: event.requestId, evidence })); assert.ok(reconcile.ok);
        // Explicit retry enters the bounded proposer once; it remains uncertain after this new interruption.
        code(await service.reflect(command), 'OUTC1017'); assert.equal(calls, 1);
      } else if (stage === 'score') {
        const score = await f.scored('crash-score', { label: 'unknown' }, ['crash-fact']);
        assert.equal((await f.store.memories.get('crash-fact'))!.confidence, .5);
        const command = f.command('project-crash', { scoreId: score.scoreId });
        assert.equal(resultValue(await f.service.project(command)).changedMemoryWrites, 1);
        const replay = await f.service.project(command); assert.ok(replay.ok && replay.replayed && replay.writes === 0);
        assert.equal((await f.store.memories.get('crash-fact'))!.confidence, .65);
      } else {
        const injected = resultValue(await f.service.injectChecked(f.query({})));
        const history = resultValue(await f.service.history(f.query({ pageSize: 200 }))) as unknown as HistoryPage;
        const event = history.entries.map(e => e.record).find(r => r.kind === 'activationEvent'); assert.ok(event && event.kind === 'activationEvent');
        const replay = await f.service.promote(f.command('promote-root', { approvalId: event.approvalId }));
        assert.ok(replay.ok && replay.replayed && replay.writes === 0); assert.deepEqual(resultValue(replay).head, injected.head);
      }
    } finally { await db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('two independent SQLite handles execute one public promotion and retain its checked head after reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'outcome-public-cas-')), path = join(dir, 'db');
  let a = await openTangleDb({ path, busyTimeout: 0 }), b = await openTangleDb({ path, busyTimeout: 0 });
  try {
    const f = await safetyFixture(false, createOutcomeStore(a));
    const versionId = resultId(await f.stage('root', { fallbackLabel: 'unknown', rules: [{ prefix: 'accept:', label: 'yes' }] }), 'versionId');
    const evaluationId = resultId(await f.evaluate(versionId, 'root'), 'evaluationId');
    const approvals = await Promise.all([0, 1].map(i => f.approve('root:' + i, versionId, evaluationId, { versionId: null, revision: 0 })));
    const other = await createOutcomeService({ ...f.host, store: createOutcomeStore(b) });
    const commands = approvals.map((r, i) => f.command('promote:' + i, { approvalId: resultId(r, 'approvalId') }));
    const results = await Promise.all([f.service.promote(commands[0]), other.promote(commands[1])]);
    // A driver's busy refusal is known rollback; explicitly retry that request after contention settles.
    for (let i = 0; i < results.length; i++) { const result = results[i]; if (!result.ok && result.issues.some(e => e.retryable)) results[i] = await (i ? other : f.service).promote(commands[i]); }
    assert.equal(results.filter(r => r.ok).length, 1); results.filter(r => !r.ok).forEach(r => code(r, 'OUTC1013'));
    await a.close(); a = await openTangleDb({ path, busyTimeout: 0 });
    const reopened = await createOutcomeService({ ...f.host, store: createOutcomeStore(a) });
    assert.deepEqual(resultValue(await reopened.injectChecked(f.query({}))).head, { versionId, revision: 1 });
  } finally { await a.close(); await b.close(); await rm(dir, { recursive: true, force: true }); }
});
