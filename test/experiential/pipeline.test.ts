import { it } from 'node:test';
import assert from 'node:assert/strict';
import { compileDag } from '@jarenjs/flow';
import { createExperientialMemoryStore, createExperientialTrainingTasks, EXPERIENTIAL_TRAINING_DAG,
  EXPERIENTIAL_TRAINING_NODES, planTrainingTransition, cancelExperientialTraining, sealExperientialRecord,
  type ExperientialTrainingContext } from '@tangleai/experiential';
import { accepted } from './identity-fixtures.ts';
import { SELECTION_TIME } from './selection-fixtures.ts';
import { trainingFixture } from './pipeline-fixtures.ts';

async function fixture(options: Parameters<typeof trainingFixture>[2] = {}, applyProbe?: (step: string) => void) {
  const clock = { value: Date.parse(SELECTION_TIME) };
  const store = createExperientialMemoryStore({ now: () => new Date(clock.value).toISOString(), applyProbe });
  const f = await trainingFixture(store, clock, options); accepted(await store.put('training_runs', f.plan.run));
  return { ...f, store };
}
async function complete(context: ExperientialTrainingContext, input: unknown) {
  const values: Record<string, unknown> = {};
  const compiled = compileDag(EXPERIENTIAL_TRAINING_DAG, { tasks: createExperientialTrainingTasks(context), checkpoint: {
    load: () => ({ values: structuredClone(values) }),
    save: (_run, node, value) => { values[node] = structuredClone(value); },
    complete: () => {},
  } });
  for (let attempt = 0; attempt < 16; attempt++) {
    try { await compiled.run(input, { runId: 'fixture', drainOnAbort: true }); return; }
    catch (error) { if (!String(error).includes('pending')) throw error; }
  }
  assert.fail('The bounded fixture did not complete.');
}

it('the native DAG trains once, verifies bytes, stages one artifact and replays without another effect', async () => {
  const f = await fixture();
  try {
    await complete(f.context, f.plan.input);
    const run = accepted(await f.store.get('training_runs', f.plan.run.id))!;
    assert.equal(run.state, 'complete'); assert.equal(run.submissions, 1); assert.equal(run.progress!.polls, 4);
    assert.equal(run.progress!.observations, 4); assert.equal(run.progress!.stage, 'registered');
    const artifact = accepted(await f.store.get('artifacts', run.progress!.artifactId!))!;
    assert.equal(artifact.state, 'staged'); assert.equal(artifact.checksum, run.progress!.receipt!.sha256);
    assert.equal(f.store.stats().activations, 0);
    const counters = f.backend.stats(), writes = f.store.stats().writes;
    await complete(f.context, f.plan.input);
    assert.deepEqual(f.backend.stats(), counters); assert.equal(f.store.stats().writes, writes);
    assert.equal(accepted(await f.store.list('training_runs', run.scope)).length, 1);
    assert.equal(accepted(await f.store.list('artifacts', run.scope)).length, 2);
    const { id: _, ...body } = artifact;
    const forged = accepted(await sealExperientialRecord('artifact', { ...body, checksum: 'a'.repeat(64) }));
    assert.equal((await f.store.put('artifacts', forged)).ok, false);
  } finally { await f.store.close(); }
});

it('slow preparation, regressed clocks, unknown spend and malformed backend outputs fail closed', async () => {
  for (const mode of ['capability-wall', 'render-wall', 'clock', 'unknown-spend', 'spend', 'protocol', 'manifest'] as const) {
    const f = await fixture({ budget: mode.includes('spend') ? { maxSpend: 1 } : {} });
    try {
      if (mode === 'capability-wall') f.context.backend = { ...f.backend, capabilities: async () => {
        f.clock.value += 60_000; return f.backend.capabilities();
      } };
      if (mode === 'render-wall' || mode === 'manifest') {
        const original = f.context.resolveExamples;
        f.context.resolveExamples = async (...args) => {
          const result = await original(...args);
          if (mode === 'render-wall') f.clock.value += 60_000;
          else result.template = { invalid: 'changed pinned template' };
          return result;
        };
      }
      if (mode === 'clock') f.context.sleep = async () => { f.clock.value--; };
      if (mode === 'unknown-spend' || mode === 'spend' || mode === 'protocol') f.context.backend = { ...f.backend,
        inspect: async id => ({ ok: true, value: { ...accepted(await f.backend.inspect(id)),
          ...(mode === 'protocol' ? { authorization: 'SENTINEL_SECRET_HEADER' } : { spend: mode === 'unknown-spend' ? null : 2 }) } }) };
      await complete(f.context, f.plan.input);
      const run = accepted(await f.store.get('training_runs', f.plan.run.id))!;
      assert.equal(run.state, 'failed', mode); assert.equal(run.progress!.artifactId, null);
      assert.equal(accepted(await f.store.list('artifacts', run.scope)).length, 1);
      if (['capability-wall', 'render-wall', 'manifest'].includes(mode)) assert.equal(f.backend.stats().submitRequests, 0);
      assert.ok(!JSON.stringify(run).includes('SENTINEL_SECRET_HEADER'));
    } finally { await f.store.close(); }
  }
});

it('registration rolls back the run, artifact and audit event together at each write boundary', async () => {
  for (const point of ['put:experiential_training_runs', 'put:experiential_artifacts', 'put:experiential_events', 'commit']) {
    let armed = false;
    const f = await fixture({}, step => { if (armed && point === step) throw new Error('Fixture registration interruption.'); });
    try {
      const tasks = createExperientialTrainingTasks(f.context), args = { input: f.plan.input };
      for (const node of EXPERIENTIAL_TRAINING_NODES.slice(0, 6)) {
        if (node === 'poll') for (let i = 0; i < 3; i++) await assert.rejects(tasks.poll.run(args), /pending/);
        await tasks[node].run(args);
      }
      const before = accepted(await f.store.get('training_runs', f.plan.run.id))!, events = accepted(await f.store.list('events', before.scope));
      armed = true; await assert.rejects(tasks.register.run(args)); armed = false;
      assert.deepEqual(accepted(await f.store.get('training_runs', before.id)), before);
      assert.deepEqual(accepted(await f.store.list('events', before.scope)), events);
      assert.equal(accepted(await f.store.list('artifacts', before.scope)).length, 1);
      await tasks.register.run(args); assert.equal(accepted(await f.store.get('training_runs', before.id))!.state, 'complete');
    } finally { armed = false; await f.store.close(); }
  }
});

it('capability, training, poll, checksum, record, byte and wall failures never stage a learned artifact', async () => {
  for (const mode of ['capability', 'inference-only', 'training', 'poll', 'checksum', 'records', 'bytes', 'wall'] as const) {
    const f = await fixture({ fake: mode === 'training' ? { failAt: 'training' } : mode === 'checksum' ? { corruptChecksum: true } : {},
      budget: mode === 'poll' ? { maxPolls: 1 } : mode === 'records' ? { maxRecords: 1 } : mode === 'bytes' ? { maxBytes: 1 } : {} });
    try {
      if (mode === 'capability' || mode === 'inference-only') f.context.backend = { ...f.backend,
        capabilities: async () => ({ ...await f.backend.capabilities(), ...(mode === 'capability' ? { methods: [] } : { trainable: false }) }) };
      if (mode === 'wall') f.context.sleep = async () => { f.clock.value += 60_000; };
      await complete(f.context, f.plan.input);
      const run = accepted(await f.store.get('training_runs', f.plan.run.id))!;
      assert.equal(run.state, 'failed', mode); assert.equal(run.progress!.artifactId, null, mode);
      assert.equal(accepted(await f.store.list('artifacts', run.scope)).length, 1, mode);
      assert.equal(run.submissions, ['capability', 'inference-only', 'records', 'bytes'].includes(mode) ? 0 : 1, mode);
      if (mode === 'poll') { assert.equal(run.stopReason, 'poll-budget'); assert.equal(run.progress!.polls, 1); assert.equal(f.backend.stats().inspections, 1); }
      if (mode === 'checksum') assert.equal(run.progress!.issues[0].code, 'TEXP1008');
      if (mode === 'wall') assert.equal(run.stopReason, 'wall-budget');
    } finally { await f.store.close(); }
  }
});

it('checked commands refuse generic completion, forged verification, stale reservations and cancelled activation', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.store.transition(accepted(planTrainingTransition(f.plan.run, 'preparing')))).ok, false);
    const tasks = createExperientialTrainingTasks(f.context), args = { input: f.plan.input };
    for (const node of ['select', 'render', 'submit'] as const) await tasks[node].run(args);
    const before = accepted(await f.store.get('training_runs', f.plan.run.id))!;
    const a = await f.store.training(before.id, before.progress!.revision, { kind: 'poll-reserve' }); assert.equal(a.ok, true);
    assert.equal((await f.store.training(before.id, before.progress!.revision, { kind: 'poll-reserve' })).ok, false);
    const cancelled = await cancelExperientialTraining(f.store, f.backend, before.id); assert.equal(cancelled.ok, true);
    await complete(f.context, f.plan.input);
    const run = accepted(await f.store.get('training_runs', before.id))!;
    assert.equal(run.state, 'cancelled'); assert.equal(run.progress!.artifactId, null); assert.equal(f.backend.stats().cancellations, 1);
  } finally { await f.store.close(); }
  const v = await fixture();
  try {
    const tasks = createExperientialTrainingTasks(v.context), args = { input: v.plan.input };
    for (const node of EXPERIENTIAL_TRAINING_NODES.slice(0, 5)) {
      if (node === 'poll') for (let i = 0; i < 3; i++) await assert.rejects(tasks.poll.run(args), /pending/);
      await tasks[node].run(args);
    }
    const run = accepted(await v.store.get('training_runs', v.plan.run.id))!;
    const fake = { receipt: run.progress!.receipt!, verifiedBytes: run.progress!.receipt!.sizeBytes };
    assert.equal((await v.store.training(run.id, run.progress!.revision, { kind: 'verified', verification: fake })).ok, false);
    assert.equal((await v.store.training(run.id, run.progress!.revision, { kind: 'register' })).ok, false);
    await tasks.verify.run(args); await tasks.register.run(args);
    assert.equal(accepted(await v.store.get('training_runs', run.id))!.state, 'complete');
  } finally { await v.store.close(); }
});
