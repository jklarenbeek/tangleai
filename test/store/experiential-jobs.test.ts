import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileDag } from '@jarenjs/flow';
import { createDagJobRunner, type JobOutcome, type JobWorker } from '@jarenjs/db';
import { EXPERIENTIAL_TRAINING_DAG, EXPERIENTIAL_TRAINING_NODES, createExperientialTrainingTasks,
  experientialTrainingJobKind, planExperientialTraining, cancelExperientialTraining, EXPERIENTIAL_TABLES,
  planExperientialDataset, planExperientialSelection } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbStore, enqueueExperientialTraining, createExperientialTrainingRunner,
  type TangleDb, type ExperientialTrainingRunnerOptions } from '@tangleai/store';
import { accepted } from '../experiential/identity-fixtures.ts';
import { trainingFixture } from '../experiential/pipeline-fixtures.ts';
import { SELECTION_TIME } from '../experiential/selection-fixtures.ts';
import { datasetOptions } from '../experiential/dataset-fixtures.ts';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function rig(options: Parameters<typeof trainingFixture>[2] = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'tangle-training-')), path = join(dir, 'training.sqlite');
  const clock = { value: Date.parse(SELECTION_TIME) };
  const open = () => openTangleDb({ path, jobs: { now: () => clock.value, random: () => .5, backoffBase: 0, backoffCap: 0 } });
  let db = await open();
  const store = () => createExperientialDbStore(db, { now: () => new Date(clock.value).toISOString() });
  const fixture = await trainingFixture(store(), clock, options);
  return { ...fixture, get db() { return db; }, store,
    async reopen() { await db.close(); db = await open(); },
    async close() { await db.close(); await rm(dir, { recursive: true, force: true }); } };
}
type Rig = Awaited<ReturnType<typeof rig>>;
async function run(f: Rig, changes: Partial<ExperientialTrainingRunnerOptions> = {}, terminal: JobOutcome['outcome'] = 'completed') {
  const done = deferred<JobOutcome>(), outcomes: JobOutcome[] = [];
  const runner = await createExperientialTrainingRunner(f.db, { ...f.context, compileDag, pollInterval: 5,
    leaseMs: 300_000, ...changes, onOutcome: event => {
      outcomes.push(event);
      if (event.outcome === terminal) done.resolve(event);
      else if (event.attempt > 12) done.reject(new Error('Unexpected durable attempts: ' + JSON.stringify(outcomes)));
    } });
  runner.start();
  try { await done.promise; }
  finally { assert.equal((await runner.stop({ graceMs: 1000 })).drained, true); }
  return outcomes;
}

it('SQLite resumes after each of the seven retained node checkpoints with identical ids and one submission', { timeout: 120_000 }, async t => {
  let expected: { runId: string; artifactId: string } | undefined;
  for (const node of [null, ...EXPERIENTIAL_TRAINING_NODES]) {
    const f = await rig(); let first: JobWorker | undefined;
    try {
      assert.equal(await enqueueExperientialTraining(f.db, f.plan), f.plan.idempotencyKey);
      assert.equal(await enqueueExperientialTraining(f.db, f.plan), f.plan.idempotencyKey);
      assert.equal((await f.db.jobs!.counts()).pending, 1);
      if (node) {
        const cut = deferred<void>(), release = deferred<void>();
        const interrupted: typeof compileDag = (document, options) => {
          const checkpoint = options!.checkpoint!;
          return compileDag(document, { ...options, checkpoint: { ...checkpoint,
            save: async (id, current, value) => {
              await checkpoint.save(id, current, value);
              if (current === node) { cut.resolve(); await release.promise; throw new Error('Fixture termination after retained checkpoint.'); }
            },
          } });
        };
        first = await createExperientialTrainingRunner(f.db, { ...f.context, compileDag: interrupted, pollInterval: 5, leaseMs: 300_000 });
        first.start(); await cut.promise;
        const stopped = first.stop({ graceMs: 1000 }); release.resolve();
        assert.equal((await stopped).drained, true); first = undefined;
        assert.notEqual((await f.db.jobs!.get(f.plan.idempotencyKey))!.state, 'done');
        await f.reopen();
      }
      await run(f);
      const record = accepted(await f.store().get('training_runs', f.plan.run.id))!;
      assert.equal(record.state, 'complete', node ?? 'uninterrupted');
      assert.equal(record.submissions, 1); assert.equal(f.backend.stats().submitRequests, 1);
      assert.equal(f.backend.stats().submissions, 1); assert.equal(record.progress!.polls, 4);
      const ids = { runId: record.id, artifactId: record.progress!.artifactId! };
      if (expected) assert.deepEqual(ids, expected); else expected = ids;
      assert.equal(accepted(await f.store().get('artifacts', ids.artifactId))!.state, 'staged');
      const counters = f.backend.stats(); await enqueueExperientialTraining(f.db, f.plan);
      assert.equal((await f.db.jobs!.counts()).done, 1); assert.deepEqual(f.backend.stats(), counters);
      assert.equal(accepted(await f.store().list('training_runs', record.scope)).length, 1);
      assert.equal(accepted(await f.store().list('artifacts', record.scope)).length, 2);
      t.diagnostic(JSON.stringify({ checkpoint: node ?? 'uninterrupted', ...ids, state: record.state,
        submissions: record.submissions, pollReservations: record.progress!.polls, observations: record.progress!.observations,
        backend: f.backend.stats() }));
    } finally { await first?.stop({ graceMs: 1000 }); await f.close(); }
  }
});

it('two native workers keep separate lease contexts and submit each distinct spec exactly once', { timeout: 30_000 }, async () => {
  const f = await rig(); let worker: JobWorker | undefined;
  try {
    const second = accepted(await planExperientialTraining({ dataset: f.data.dataset, base: f.base,
      spec: { ...f.plan.run.spec!, seed: 17754 }, backendIdentity: f.backend.identity, runtime: f.base.runtime, recordedAt: SELECTION_TIME }));
    await enqueueExperientialTraining(f.db, f.plan); await enqueueExperientialTraining(f.db, second);
    const completed = new Set<string>(), done = deferred<void>();
    worker = await createExperientialTrainingRunner(f.db, { ...f.context, compileDag, pollInterval: 5, concurrency: 2,
      leaseMs: 300_000, onOutcome: event => {
        if (event.outcome === 'completed') completed.add(event.jobId);
        if (completed.size === 2) done.resolve();
        else if (event.attempt > 12) done.reject(new Error('Concurrent training exhausted recovery attempts.'));
      } });
    worker.start(); await done.promise; await worker.stop({ graceMs: 1000 }); worker = undefined;
    for (const plan of [f.plan, second]) {
      const record = accepted(await f.store().get('training_runs', plan.run.id))!;
      assert.equal(record.state, 'complete'); assert.equal(record.submissions, 1);
    }
    assert.equal(f.backend.stats().submitRequests, 2); assert.equal(f.backend.stats().submissions, 2);
  } finally { await worker?.stop({ graceMs: 1000 }); await f.close(); }
});

it('cancellation while the provider is training fences its late observation and stages no artifact', { timeout: 30_000 }, async () => {
  const f = await rig(); let worker: JobWorker | undefined;
  try {
    await enqueueExperientialTraining(f.db, f.plan);
    const training = deferred<void>(), release = deferred<void>(), done = deferred<void>();
    const backend = { ...f.backend, inspect: async (id: string) => {
      const result = await f.backend.inspect(id);
      if (result.ok && result.value.state === 'training') { training.resolve(); await release.promise; }
      return result;
    } };
    worker = await createExperientialTrainingRunner(f.db, { ...f.context, backend, compileDag, pollInterval: 5,
      leaseMs: 300_000, onOutcome: event => { if (event.outcome === 'completed') done.resolve(); } });
    worker.start(); await training.promise;
    const cancelled = await cancelExperientialTraining(f.store(), backend, f.plan.run.id); assert.equal(cancelled.ok, true);
    release.resolve(); await done.promise; await worker.stop({ graceMs: 1000 }); worker = undefined;
    const record = accepted(await f.store().get('training_runs', f.plan.run.id))!;
    assert.equal(record.state, 'cancelled'); assert.equal(record.progress!.polls, 2); assert.equal(record.progress!.observations, 1);
    assert.equal(record.progress!.artifactId, null); assert.equal(f.backend.stats().cancellations, 1);
    assert.equal(accepted(await f.store().list('artifacts', record.scope)).length, 1);
  } finally { await worker?.stop({ graceMs: 1000 }); await f.close(); }
});

it('native resume refuses a changed DAG before checkpoint loading or backend effects', { timeout: 30_000 }, async () => {
  const f = await rig(); let runner: JobWorker | undefined;
  try {
    await enqueueExperientialTraining(f.db, f.plan);
    const cut = deferred<void>(), release = deferred<void>();
    runner = await createExperientialTrainingRunner(f.db, { ...f.context, pollInterval: 5, compileDag: (document: unknown, options: Parameters<typeof compileDag>[1]) => {
      const checkpoint = options!.checkpoint!;
      return compileDag(document, { ...options, checkpoint: { ...checkpoint, save: async (id, node, value) => {
        await checkpoint.save(id, node, value);
        if (node === 'select') { cut.resolve(); await release.promise; throw new Error('Fixture termination.'); }
      } } });
    } });
    runner.start(); await cut.promise; const stopped = runner.stop({ graceMs: 1000 }); release.resolve(); await stopped;
    let loads = 0;
    const changed = structuredClone(EXPERIENTIAL_TRAINING_DAG) as { nodes: Record<string, unknown> };
    changed.nodes.extra = { kind: 'const', value: 'different retained document' };
    const failed = deferred<void>();
    runner = createDagJobRunner(f.db, { compileDag: (document: unknown, options: Parameters<typeof compileDag>[1]) => {
      const checkpoint = options!.checkpoint!;
      return compileDag(document, { ...options, checkpoint: { ...checkpoint, load: (...args) => { loads++; return checkpoint.load(...args); } } });
    }, documents: { [experientialTrainingJobKind(f.plan.pipelineRevision)]: changed },
    tasks: createExperientialTrainingTasks({ ...f.context, store: f.store() }), pollInterval: 5,
    onOutcome: () => failed.resolve() });
    runner.start(); await failed.promise; await runner.stop({ graceMs: 1000 }); runner = undefined;
    const job = await f.db.jobs!.get(f.plan.idempotencyKey);
    assert.match(JSON.stringify(job), /JD2069/); assert.equal(loads, 0); assert.equal(f.backend.stats().submitRequests, 0);
  } finally { await runner?.stop({ graceMs: 1000 }); await f.close(); }
});

it('uncertain submission pauses durably, never resubmits, and resumes only through explicit lookup', { timeout: 30_000 }, async () => {
  const f = await rig();
  try {
    await enqueueExperientialTraining(f.db, f.plan);
    let job: Awaited<ReturnType<typeof f.backend.submit>> | undefined;
    const backend = { ...f.backend, submit: async (spec: Parameters<typeof f.backend.submit>[0]) => {
      job = await f.backend.submit(spec); throw new Error('SENTINEL_AUTH_HEADER_MUST_NOT_PERSIST');
    } };
    await run(f, { backend }, 'cancelled');
    let record = accepted(await f.store().get('training_runs', f.plan.run.id))!;
    assert.equal(record.progress!.dispatch, 'unknown'); assert.equal(record.submissions, 1);
    assert.equal(record.progress!.artifactId, null); assert.equal(f.backend.stats().submitRequests, 1);
    assert.equal((await f.db.jobs!.get(f.plan.idempotencyKey))!.state, 'cancelled');
    await f.reopen(); await f.db.jobs!.requeue(f.plan.idempotencyKey);
    await run(f, { backend, reconcileSubmission: async () => { assert.ok(job); return job; } });
    record = accepted(await f.store().get('training_runs', record.id))!;
    assert.equal(record.state, 'complete'); assert.equal(f.backend.stats().submitRequests, 1);
    const persisted = [await f.db.jobs!.get(f.plan.idempotencyKey),
      ...await Promise.all(EXPERIENTIAL_TABLES.map(async table => accepted(await f.store().list(table, record.scope))))];
    assert.ok(!JSON.stringify(persisted).includes('SENTINEL_AUTH_HEADER_MUST_NOT_PERSIST'));
  } finally { await f.close(); }
});

it('lost leases cannot publish poll observations and consumed credits survive reclaim', { timeout: 30_000 }, async () => {
  const f = await rig(); let worker: JobWorker | undefined;
  try {
    await enqueueExperientialTraining(f.db, f.plan);
    const inspecting = deferred<void>(), release = deferred<void>(), lost = deferred<void>();
    const backend = { ...f.backend, inspect: async (id: string) => {
      const state = await f.backend.inspect(id); inspecting.resolve(); await release.promise; return state;
    } };
    worker = await createExperientialTrainingRunner(f.db, { ...f.context, backend, compileDag, pollInterval: 5,
      leaseMs: 1000, renew: false, onOutcome: event => { if (event.outcome === 'lost') lost.resolve(); } });
    worker.start(); await inspecting.promise; f.clock.value += 1001;
    const reclaimed = await f.db.jobs!.claim({ kinds: [experientialTrainingJobKind(f.plan.pipelineRevision)], owner: 'replacement', leaseMs: 60_000 });
    assert.ok(reclaimed); release.resolve(); await lost.promise;
    await worker.stop({ graceMs: 1000 }); worker = undefined;
    const pending = accepted(await f.store().get('training_runs', f.plan.run.id))!;
    assert.equal(pending.progress!.polls, 1); assert.equal(pending.progress!.observations, 0); assert.equal(pending.progress!.artifactId, null);
    await f.db.jobs!.fail(reclaimed.lease, new Error('Fixture releases the replacement lease.'));
    await run(f);
    const record = accepted(await f.store().get('training_runs', f.plan.run.id))!;
    assert.equal(record.state, 'complete'); assert.equal(record.progress!.polls, 4); assert.equal(record.progress!.observations, 3);
    assert.equal(f.backend.stats().submitRequests, 1);
  } finally { await worker?.stop({ graceMs: 1000 }); await f.close(); }
});

it('SQLite terminal failures, cancellation and changed dataset plans retain explicit bounded results', { timeout: 60_000 }, async () => {
  for (const mode of ['poll', 'checksum', 'training', 'cancel', 'capability', 'inference-only'] as const) {
    const f = await rig({ budget: mode === 'poll' ? { maxPolls: 2 } : {},
      fake: mode === 'checksum' ? { corruptChecksum: true } : mode === 'training' ? { failAt: 'training' } : {} });
    try {
      await enqueueExperientialTraining(f.db, f.plan);
      if (mode === 'cancel') accepted(await cancelExperientialTraining(f.store(), f.backend, f.plan.run.id));
      const backend = ['capability', 'inference-only'].includes(mode) ? { ...f.backend, capabilities: async () => ({ ...await f.backend.capabilities(),
        ...(mode === 'capability' ? { methods: [] } : { trainable: false }) }) } : f.backend;
      await run(f, { backend });
      const record = accepted(await f.store().get('training_runs', f.plan.run.id))!;
      assert.equal(record.state, mode === 'cancel' ? 'cancelled' : 'failed'); assert.equal(record.progress!.artifactId, null);
      assert.equal(accepted(await f.store().list('artifacts', record.scope)).length, 1);
      if (mode === 'poll') { assert.equal(record.progress!.polls, 2); assert.equal(f.backend.stats().inspections, 2); }
      if (['capability', 'inference-only'].includes(mode)) assert.equal(record.submissions, 0);
      const selected = accepted(await planExperientialSelection({ experiences: f.data.experiences, assessments: f.data.assessments, ...f.data.dataset.selection! }));
      const data = accepted(await planExperientialDataset(selected, datasetOptions({ seed: 17754 })));
      accepted(await f.store().put('datasets', data.dataset));
      assert.notEqual(data.dataset.manifestDigest, f.data.dataset.manifestDigest);
      const changed = accepted(await planExperientialTraining({ dataset: data.dataset, base: f.base,
        spec: { ...f.plan.run.spec!, datasetId: data.dataset.id, manifestDigest: data.dataset.manifestDigest },
        backendIdentity: f.backend.identity, runtime: f.base.runtime, recordedAt: SELECTION_TIME }));
      assert.notEqual(await enqueueExperientialTraining(f.db, changed), f.plan.idempotencyKey);
    } finally { await f.close(); }
  }
});

it('the host assembles native jobs without another scheduler or a second backend interface', async () => {
  const adapter = await readFile('packages/store/src/experiential-jobs.ts', 'utf8');
  assert.match(adapter, /createDagJobRunner/); assert.match(adapter, /tx\.jobs\.assertLease/);
  assert.doesNotMatch(adapter, /new Map|setTimeout|setInterval|createScheduler/);
  const pipeline = await readFile('packages/experiential/src/pipeline.ts', 'utf8');
  assert.doesNotMatch(pipeline, /@tangleai\/mas|setTimeout|setInterval/);
});
