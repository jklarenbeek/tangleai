/**
 * Resuming is the same drive over what the store already holds: a completed
 * unit is replayed, a unit whose key moved is dispatched again, and a run
 * that finished costs nothing to drive a second time.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activateCandidate, assertUnitReuse, createMemoryTrace2SkillStore, refuseRepeatedWork, resumeCensus,
  resumeRun, runIsReplayOnly, runRollouts, storedRun,
} from '@tangleai/trace2skill';
import { loadTrace2SkillFixture } from '../../benchmark/lib/trace2skill-fixture.ts';
import { executeSkillMode } from '../../benchmark/lib/trace2skill-report.ts';
import { readFrozenSkill, runRecord, scriptedClient, taskRecords, testAdapter } from './fixture.ts';

const IDS = ['task-01', 'task-02'];
const TASKS = IDS.map((id, index) => ({ id, prompt: `count ${id}`, input: 'a,b\n1,2\n', answer: String(index + 1) }));
const ANSWERING = (answer: string) => scriptedClient([{ answer }]);

it('an interrupted drive resumes without repeating a completed model call', async () => {
  const loaded = await loadTrace2SkillFixture();
  const whole = { calls: 0 };
  const reference = await executeSkillMode(loaded, 'deepening', { meter: whole });
  assert.ok(whole.calls > 0);

  // A wire that stops answering stands in for a lost process. The limit lands
  // on a unit boundary, so nothing half-executed has to be paid for twice.
  const store = createMemoryTrace2SkillStore();
  const interrupted = { calls: 0 };
  await assert.rejects(
    () => executeSkillMode(loaded, 'deepening', { store, meter: interrupted, callLimit: 18 }),
    /interrupted/);
  assert.equal(interrupted.calls, 18);
  const remaining = { calls: 0 };
  const resumed = await executeSkillMode(loaded, 'deepening', { store, meter: remaining });
  assert.equal(remaining.calls, whole.calls - 18, 'the resume makes exactly the calls the interruption left');
  assert.equal(interrupted.calls + remaining.calls, whole.calls, 'no completed model call is paid for twice');
  assert.ok(resumed.run.counts.reused > 0, 'the interrupted drive kept what it finished');
  assert.equal(resumed.consolidation?.candidate?.id, reference.consolidation?.candidate?.id);
  assert.equal(resumed.evaluation?.evaluation?.eligible, true);
});

it('a finished run driven again spends nothing, writes nothing and stages the same candidate', async () => {
  const loaded = await loadTrace2SkillFixture();
  const store = createMemoryTrace2SkillStore();
  const first = await executeSkillMode(loaded, 'deepening', { store });
  const meter = { calls: 0 };
  const again = await executeSkillMode(loaded, 'deepening', { store, meter });
  assert.equal(meter.calls, 0);
  assert.deepEqual(again.run.counts, { calls: 0, written: 0, reused: again.run.counts.reused, refused: 0 });
  assert.ok(runIsReplayOnly(again.run).valid, JSON.stringify(runIsReplayOnly(again.run)));
  const census = resumeCensus(again.run);
  assert.equal(census.stages, 13);
  assert.equal(census.executed, 13);
  assert.ok(refuseRepeatedWork(census).valid);
  assert.equal(again.consolidation?.candidate?.id, first.consolidation?.candidate?.id);
  assert.equal(again.evaluation?.evaluation?.id, first.evaluation?.evaluation?.id);

  // A drive that did spend is not a resume of a finished run, and says so.
  const spent = refuseRepeatedWork({ ...census, calls: 3 });
  assert.ok(!spent.valid);
  assert.equal(spent.issues[0].code, 'TT2S1012');
});

it('a run driven again after its candidate became the active directory still spends nothing', async () => {
  const loaded = await loadTrace2SkillFixture();
  const store = createMemoryTrace2SkillStore();
  const first = await executeSkillMode(loaded, 'deepening', { store });
  const evaluation = first.evaluation?.evaluation;
  const candidate = first.consolidation?.candidate;
  assert.ok(evaluation !== undefined && evaluation !== null && candidate != null);

  const activated = await activateCandidate(store, {
    scopeKey: evaluation.scopeKey, candidateId: candidate.id, evaluationId: evaluation.id, actor: 'test',
    registration: {
      scopeKey: evaluation.scopeKey, executorIdentityId: evaluation.executorIdentityId,
      policyVersion: evaluation.policyVersion, testHash: evaluation.testHash,
      expectedHead: evaluation.expectedHead,
    },
  });
  assert.equal(activated.outcome, 'activated', JSON.stringify(activated.issues));
  assert.equal(activated.head.versionId, candidate.bundleId);

  // The head has moved on: the starting directory is archived and the
  // candidate is active. Driving the same run again must still be a replay.
  const meter = { calls: 0 };
  const again = await executeSkillMode(loaded, 'deepening', { store, meter });
  assert.equal(meter.calls, 0);
  assert.equal(again.run.counts.written, 0, 'a settled directory is not written a second time');
  assert.equal(again.run.counts.refused, 0);
  assert.deepEqual(again.run.issues, []);
  assert.equal(again.consolidation?.candidate?.id, candidate.id);
  assert.equal((await store.head(evaluation.scopeKey)).versionId, candidate.bundleId, 'the drive did not re-seat a head');
  assert.equal((await store.getBundle(candidate.bundleId)).valid && (await store.getBundle(candidate.bundleId) as { value: { status: string } }).value.status, 'active');
});

it('resuming a stored run drives every stage and states why each idle one did nothing', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  assert.ok((await store.putSnapshot(frozen)).valid);
  assert.ok((await store.putRun(run)).valid);
  const deps = {
    store, adapter, tasks: taskRecords(IDS, 'test'), snapshot: frozen,
    baselineCondition: 'frozen-s0', modelIdentity: 'scripted', now: () => 0,
    executorClient: (task: { id: string }) => ANSWERING(task.id.slice(-1)),
    analystClient: () => ANSWERING('x'),
    mergeClient: () => ANSWERING('x'),
  };
  const resumed = await resumeRun(run.id, deps);
  assert.ok(resumed.valid, resumed.valid ? '' : JSON.stringify(resumed.issues));
  const census = resumeCensus(resumed.value);
  assert.equal(census.stages, 13);
  assert.equal(census.executed, 5, 'a run with no evolve task performs only its baselines');
  assert.equal(census.idle, 8);
  assert.ok(resumed.value.stages.filter(receipt => !receipt.executed)
    .every(receipt => typeof receipt.reason === 'string' && receipt.reason.length > 0));
  assert.equal(resumed.value.baselines.length, 2);
  assert.equal(resumed.value.evaluation, null);
  assert.deepEqual(resumed.value.issues, []);

  // Resuming the finished run replays it.
  const again = await resumeRun(run.id, deps);
  assert.ok(again.valid);
  assert.ok(runIsReplayOnly(again.value).valid, JSON.stringify(runIsReplayOnly(again.value)));
});

it('a changed prompt version creates new units and a forced reuse is refused', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const adapter = testAdapter(TASKS);
  const run = runRecord({ s0Hash: frozen.bundle.id });
  const deps = {
    store, adapter, snapshot: frozen, condition: 'frozen-s0', modelIdentity: 'scripted',
    now: () => 0, client: (task: { id: string }) => ANSWERING(task.id.slice(-1)),
  };
  const first = await runRollouts(run, taskRecords(IDS), { ...deps, promptVersion: 'executor-1' });
  assert.equal(first.counts.written, 2);
  const replay = await runRollouts(run, taskRecords(IDS), { ...deps, promptVersion: 'executor-1' });
  assert.equal(replay.counts.reused, 2);
  assert.equal(replay.counts.calls, 0);

  const moved = await runRollouts(run, taskRecords(IDS), { ...deps, promptVersion: 'executor-2' });
  assert.equal(moved.counts.reused, 0, 'a changed prompt version reuses nothing');
  assert.equal(moved.counts.written, 2);
  assert.equal((await store.listBy(run.id, 'rollouts')).length, 4, 'the new units land beside their predecessors');

  const stored = first.units[0];
  const forced = assertUnitReuse(stored, moved.units[0].idempotencyKey, '/rollouts/task-01');
  assert.ok(!forced.valid);
  assert.equal(forced.issues[0].code, 'TT2S1012');
  assert.ok(assertUnitReuse(stored, stored.idempotencyKey, '/rollouts/task-01').valid);
});

it('a resume names the run it continues, or refuses', async () => {
  const frozen = await readFrozenSkill();
  const store = createMemoryTrace2SkillStore();
  const run = runRecord({ s0Hash: frozen.bundle.id });
  assert.ok((await store.putSnapshot(frozen)).valid);
  assert.ok((await store.putRun(run)).valid);
  const found = await storedRun({ store, snapshot: frozen }, run.id);
  assert.ok(found.valid);
  assert.equal(found.value.id, run.id);

  const missing = await storedRun({ store, snapshot: frozen }, '9'.repeat(64));
  assert.ok(!missing.valid);
  assert.equal(missing.issues[0].code, 'TT2S1012');

  const drifted = { ...frozen, bundle: { ...frozen.bundle, id: '8'.repeat(64) } };
  const stale = await storedRun({ store, snapshot: drifted }, run.id);
  assert.ok(!stale.valid);
  assert.equal(stale.issues[0].code, 'TT2S1012');

  const refused = await resumeRun('9'.repeat(64), {
    store, adapter: testAdapter(TASKS), tasks: taskRecords(IDS, 'test'), snapshot: frozen,
    baselineCondition: 'frozen-s0', modelIdentity: 'scripted',
    executorClient: (task) => ANSWERING(task.id.slice(-1)),
    analystClient: () => ANSWERING('x'),
    mergeClient: () => ANSWERING('x'),
  });
  assert.ok(!refused.valid);
  assert.equal(refused.issues[0].code, 'TT2S1012');
});
