/**
 * The stage graph and the one drive over it: thirteen task nodes the suite
 * validates and lowers, a handler bound for every one of them, and a run log
 * that holds a header rather than a second copy of the run.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { compileMasRuntime, createMemoryContextProvider } from '@tangleai/mas';
import { createMasStore, createRunLog, openTangleDb } from '@tangleai/store';
import {
  createMemoryTrace2SkillStore, plannedStageOrder, runTrace2Skill, TRACE2SKILL_STAGES, trace2SkillGraph,
  trace2SkillRegistryDocument, trace2SkillStageHandlers,
} from '@tangleai/trace2skill';
import { loadTrace2SkillFixture } from '../../benchmark/lib/trace2skill-fixture.ts';
import { executeSkillMode } from '../../benchmark/lib/trace2skill-report.ts';

const EXPECTED = [
  'run-create', 'skill-snapshot-or-draft', 'split-validate', 'baseline-no-skill', 'baseline-s0',
  'rollouts-generate', 'rollouts-evaluate-and-label', 'analysts-dispatch', 'patches-validate',
  'merges-levels', 'candidate-compile-and-stage', 'heldout-evaluate', 'candidate-eligible-or-rejected',
];

it('the stage graph is the fixed list and activation is not one of its nodes', async () => {
  const graph = await trace2SkillGraph();
  assert.deepEqual([...TRACE2SKILL_STAGES], EXPECTED);
  assert.deepEqual(graph.workflow.nodes.map(node => node.id), EXPECTED);
  assert.deepEqual(plannedStageOrder(graph.plan), EXPECTED);
  assert.ok(graph.workflow.nodes.every(node => node.kind === 'task'), 'every stage is a task invocation');
  assert.ok(!EXPECTED.some(stage => stage.includes('activate')), 'no node activates a directory');
  assert.equal(graph.plan.regions.length, 1);
  assert.equal(graph.validated.registryRevision, graph.snapshot.revision);
});

it('the registry declares a handler for every stage and the runtime binds them all', async () => {
  const graph = await trace2SkillGraph();
  const registry = trace2SkillRegistryDocument() as { handlers: Array<{ id: string, effect: string, idempotency: string }> };
  assert.deepEqual(registry.handlers.map(handler => handler.id), EXPECTED);
  for (const handler of registry.handlers) {
    if (handler.effect === 'effectful') assert.equal(handler.idempotency, 'honored', handler.id);
  }
  const db = await openTangleDb();
  try {
    let tick = 0;
    const loaded = await loadTrace2SkillFixture();
    const executed = await executeSkillMode(loaded, 'deepening');
    const runtime = compileMasRuntime(graph.validated, graph.plan, graph.snapshot, {
      store: createMasStore(db, { now: () => `tick-${String(tick++).padStart(4, '0')}` }),
      taskHandlers: trace2SkillStageHandlers(executed.run.run, {
        store: executed.store, adapter: (await import('../../benchmark/lib/trace2skill-adapter.ts'))
          .toTaskAdapter(await (await import('../../benchmark/lib/trace2skill-adapter.ts')).createFixtureAdapter(loaded)),
        tasks: [], snapshot: executed.snapshot, baselineCondition: 'frozen-s0', modelIdentity: 'scripted',
        executorClient: () => ({ complete: async () => { throw new Error('a bound drive never calls a wire here'); } }),
        analystClient: () => ({ complete: async () => { throw new Error('a bound drive never calls a wire here'); } }),
        mergeClient: () => ({ complete: async () => { throw new Error('a bound drive never calls a wire here'); } }),
      }),
      toolBindings: {},
      contextProviders: { memory: createMemoryContextProvider({ recall: async () => [] }) },
      now: () => `tick-${String(tick++).padStart(4, '0')}`,
      clock: () => 0,
    });
    assert.ok(runtime.valid, runtime.valid ? '' : JSON.stringify(runtime.issues));
    assert.deepEqual(runtime.value.workflow.nodes.map(node => node.id), EXPECTED);
  }
  finally { await db.close(); }
});

it('one drive fills every stage receipt and carries a candidate to an eligible verdict', async () => {
  const loaded = await loadTrace2SkillFixture();
  const executed = await executeSkillMode(loaded, 'deepening');
  const receipts = executed.run.stages;
  assert.deepEqual(receipts.map(receipt => receipt.stage), EXPECTED);
  assert.ok(receipts.every(receipt => receipt.executed), 'deepening performs every stage');
  assert.ok(receipts.every(receipt => receipt.reason === null));
  assert.deepEqual(executed.run.issues, []);
  assert.equal(executed.run.counts.refused, 0);
  assert.ok(executed.consolidation?.candidate !== null);
  assert.equal(executed.evaluation?.evaluation?.eligible, true);
  assert.equal((await executed.store.getBundle(executed.evaluation!.evaluation!.candidateBundleId)).valid, true);
  // The stored run says where it stopped. A record left `running` after the
  // drive returned cannot be told from a run that is still going, and it is
  // the row a read-only surface lists.
  const records = await executed.store.listBy(executed.run.run.scopeKey, 'runs');
  assert.deepEqual([...new Set(records.map(record => record.status))], ['completed'],
    'a run record stayed open after its drive returned');
  assert.equal(records.find(record => record.id === executed.run.run.id)?.status, 'completed');

  // Creation registers no trajectory, so the learning stages idle with a
  // stated reason rather than silently doing nothing.
  const creation = await executeSkillMode(loaded, 'creation');
  const idle = creation.run.stages.filter(receipt => !receipt.executed);
  assert.deepEqual(idle.map(receipt => receipt.stage), [
    'rollouts-generate', 'rollouts-evaluate-and-label', 'analysts-dispatch', 'patches-validate',
    'merges-levels', 'candidate-compile-and-stage', 'heldout-evaluate', 'candidate-eligible-or-rejected',
  ]);
  assert.ok(idle.every(receipt => typeof receipt.reason === 'string' && receipt.reason.length > 0));
  assert.equal(creation.evaluation, null);
});

it('the run log holds one coarse header and this package writes no event rows', async () => {
  const db = await openTangleDb();
  try {
    let tick = 0;
    const runLog = createRunLog(db, { now: () => new Date(1700000000000 + (tick++) * 1000).toISOString() });
    const loaded = await loadTrace2SkillFixture();
    const executed = await executeSkillMode(loaded, 'deepening', { runLog });
    const headerId = executed.run.headerId;
    assert.ok(typeof headerId === 'string');
    const stored = await runLog.getRun(headerId);
    assert.ok(stored !== undefined);
    assert.equal(stored.events.length, 0, 'the fan-out lives in this package own rows, never in the run log');
    assert.equal(stored.run.kind, 'trace2skill');
    assert.equal(stored.run.status, 'ok');
    const summary = stored.run.summary as Record<string, unknown>;
    assert.deepEqual(Object.keys(summary).sort(), [
      'calls', 'candidateId', 'evaluationId', 'mode', 'refused', 'reused', 'runId', 's0Id', 'scopeKey', 'stages', 'written',
    ]);
    assert.equal(summary.candidateId, executed.consolidation?.candidate?.id);
    assert.deepEqual(summary.stages, EXPECTED);
    const serialized = JSON.stringify(summary);
    assert.ok(!serialized.includes('assistant') && !serialized.includes('SKILL.md'), 'no message or page text reaches the header');
    assert.equal((await runLog.listRuns(10)).length, 1);

    // A drive that fails part way settles its header too: a header left
    // `running` cannot be told from a run that is still going.
    const meter = { calls: 0 };
    const interrupted = await executeSkillMode(loaded, 'deepening', { runLog, meter, callLimit: 3 })
      .then(() => null, (cause: unknown) => cause);
    assert.ok(interrupted !== null, 'the drive finished within three calls');
    assert.equal(meter.calls, 3);
    const headers = await runLog.listRuns(10);
    assert.equal(headers.length, 2);
    const stopped = headers.find(entry => entry.id !== headerId);
    assert.ok(stopped !== undefined);
    assert.equal(stopped.status, 'error', 'an interrupted drive left its header running');
    const partial = (await runLog.getRun(stopped.id))?.run.summary as Record<string, unknown>;
    assert.equal(partial.runId, executed.run.run.id);
    assert.ok(Array.isArray(partial.stages) && (partial.stages as string[]).length < EXPECTED.length,
      'the settled header claims stages the drive never reached');

    // The record settles with the header, and the run it left behind is
    // resumable: a resumed drive that reaches the end settles it `completed`.
    const store = createMemoryTrace2SkillStore();
    await executeSkillMode(loaded, 'deepening', { runLog, store, meter: { calls: 0 }, callLimit: 3 }).then(() => null, () => null);
    // The drive's own record settles where it stopped. A held-out pass the
    // interruption caught mid-flight is still open, and says so.
    const open = await store.listBy(executed.run.run.scopeKey, 'runs');
    assert.equal(open.find(record => record.id === executed.run.run.id)?.status, 'refused',
      'an interrupted drive left its record open');
    assert.ok(open.every(record => record.status !== 'completed'));
    const resumable = await executeSkillMode(loaded, 'deepening', { runLog, store });
    assert.equal(resumable.run.counts.refused, 0);
    const settled = await store.listBy(resumable.run.run.scopeKey, 'runs');
    assert.deepEqual([...new Set(settled.map(record => record.status))], ['completed'],
      'the resumed drive could not settle the run it finished');
  }
  finally { await db.close(); }
});
