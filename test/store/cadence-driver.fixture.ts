/** Native SQLite lifecycle and foreground availability, using only the in-process fake backend. */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { compileDag } from '@jarenjs/flow';
import type { JobWorker, JobOutcome } from '@jarenjs/db';
import { createHashEmbedder } from '@tangleai/models';
import { createMemoryUnit, recallByEmbedding } from '@tangleai/memory';
import { createDocumentIngester, SafeStaticFetcher } from '@tangleai/documents';
import { createExperientialRunner, createExperientialDeployment, createFakeTrainingBackend, planExperientialRetention,
  resolveExperientialLineage, EXPERIENTIAL_TABLES, type ExperientialTrainingRecipe, type ExperientialTrainingPlan,
  type ExperientialTriggerPolicy } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbStore, enqueueExperientialTraining, createExperientialTrainingRunner,
  createDbMemoryStore, createDocumentStore } from '@tangleai/store';
import { accepted } from '../experiential/identity-fixtures.ts';
import { trainingFixture } from '../experiential/pipeline-fixtures.ts';
import { experientialStoreFixture, pendingActivation } from '../experiential/store-fixtures.ts';
import { retentionFixture } from '../experiential/retention-fixtures.ts';
import { SELECTION_TIME, selectionText } from '../experiential/selection-fixtures.ts';
import { datasetOptions } from '../experiential/dataset-fixtures.ts';

const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw Error('A parent-owned database directory is required.');
const cases: string[] = [], measurements: Record<string, unknown> = {};
let physicalRequests = 0;
globalThis.fetch = async () => { physicalRequests++; throw Error('The cadence fixture must not make a network request.'); };
function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function rig(name: string) {
  const clock = { value: Date.parse(SELECTION_TIME) }, path = join(directory!, name + '.sqlite');
  const open = () => openTangleDb({ path, jobs: { now: () => clock.value, random: () => 0.5, backoffBase: 0, backoffCap: 0 } });
  let db = await open(), fault: string | null = null, occurrence = 1;
  const store = () => createExperientialDbStore(db, { now: () => new Date(clock.value).toISOString(),
    applyProbe: step => { if (fault === step && --occurrence === 0) throw Error('Injected atomic admission fault.'); } });
  return { clock, get db() { return db; }, store,
    setFault(step: string | null, at = 1) { fault = step; occurrence = at; },
    async state(scope: string) { return Object.fromEntries(await Promise.all(EXPERIENTIAL_TABLES.map(async table => [table, accepted(await store().list(table, scope))]))); },
    async reopen() { assert.equal((await db.integrityCheck()).ok, true); await db.close(); db = await open(); },
    close: () => db.close() };
}
const policy: Partial<Omit<ExperientialTriggerPolicy, 'revision'>> = { enabled: true, minimumEligible: 1, maxCadenceMs: 10,
  scopeCooldownMs: 0, computeBudget: { maxRunsPerDay: 100, maxSpend: null }, maxQueued: 10, maxQueue: 32, concurrency: 4 };
const recipe = (profile: string, runtime: ExperientialTrainingRecipe['runtime']): ExperientialTrainingRecipe => ({ profile, runtime,
  method: 'lora', hyperparameters: { rank: 8, epochs: 1, learningRate: 0.001 }, seed: 17753, precision: 'fp32',
  budget: { maxRecords: 10, maxBytes: 1000000, maxWallMs: 60000, maxPolls: 10, maxSpend: null } });

{
  const f = await rig('duplicate-restart'); let runner: Awaited<ReturnType<typeof createExperientialRunner>> | undefined;
  try {
    const prepared = await trainingFixture(f.store(), f.clock);
    const deployment = accepted(await createExperientialDeployment({ profile: 'training-profile', scope: prepared.base.scope, candidateId: 'fake-base',
      baseArtifact: prepared.base, recordedAt: SELECTION_TIME, operationalLimits: { maxFailureRate: 0, maxP95Ms: 100, window: 10 } }));
    accepted(await f.store().put('deployments', deployment));
    const make = () => createExperientialRunner({ store: f.store(), backend: prepared.backend, recipe: recipe(deployment.profile, prepared.base.runtime),
      jobs: { enqueue: plan => enqueueExperientialTraining(f.db, plan) }, now: () => f.clock.value, sleep: prepared.context.sleep, policy });
    runner = await make(); const trigger = { scope: prepared.base.scope, kind: 'manual' as const, key: 'restartable' };
    const rows = await Promise.all(Array.from({ length: 20 }, () => runner!.run(trigger).then(accepted)));
    assert.equal(rows.filter(row => row.action === 'enqueued').length, 1); assert.equal(rows.filter(row => row.action === 'replayed').length, 19);
    assert.equal((await f.db.jobs!.counts()).pending, 1);
    const before = await f.state(prepared.base.scope); await runner.close(); runner = undefined; await f.reopen(); runner = await make();
    assert.equal(accepted(await runner.run(trigger)).action, 'replayed'); assert.equal((await f.db.jobs!.counts()).pending, 1);
    assert.deepEqual(await f.state(prepared.base.scope), before); assert.equal(prepared.backend.stats().submitRequests, 0);
    measurements.duplicateTicks = { ticks: 20, enqueued: 1, replayed: 19, jobsAfterReopen: 1, submissions: 0 };
    cases.push('duplicate-ticks-and-native-reopen');
  } finally { await runner?.close(); await f.close(); }
}

for (const mode of ['cancel', 'rebase'] as const) {
  const f = await rig('stale-' + mode); let runner: Awaited<ReturnType<typeof createExperientialRunner>> | undefined, worker: JobWorker | undefined;
  try {
    const fixture = await experientialStoreFixture(f.store()); f.clock.value += 1000;
    const backend = createFakeTrainingBackend({ seed: 17753, clock: () => f.clock.value, baseModels: [fixture.artifact.id], runtime: fixture.base.runtime });
    const trainingRecipe = recipe('fixture-profile', fixture.base.runtime), plans: ExperientialTrainingPlan[] = [];
    runner = await createExperientialRunner({ store: f.store(), backend, recipe: trainingRecipe, policy: { ...policy, onStaleParent: mode },
      now: () => f.clock.value, sleep: async ms => { f.clock.value += ms; }, jobs: { enqueue: plan => { plans.push(plan); return enqueueExperientialTraining(f.db, plan); } } });
    const trigger = { scope: 'fixture', kind: 'manual' as const, key: 'stale-parent' };
    const first = accepted(await runner.run(trigger));
    const moved = await pendingActivation(f.store(), fixture, 'native-superseding-parent'); accepted(await f.store().activate(moved)); f.clock.value += 1000;
    const head = accepted(await f.store().head('fixture-profile', 'fixture')), approvals = accepted(await f.store().list('approvals', 'fixture'));
    const result = accepted(await runner.run(trigger)); assert.equal(result.action, mode === 'cancel' ? 'cancelled' : 'rebased');
    assert.equal(accepted(await f.store().get('training_runs', plans[0].run.id))?.state, 'cancelled');
    if (mode === 'rebase') { assert.notEqual(result.jobId, first.jobId); assert.equal(plans[1].run.baseArtifactId, moved.artifact.id); }
    const execution = createFakeTrainingBackend({ seed: 17753, clock: () => f.clock.value, baseModels: [fixture.artifact.id, moved.artifact.id], runtime: fixture.base.runtime });
    const done = deferred(), completed = new Set<string>();
    worker = await createExperientialTrainingRunner(f.db, { backend: execution, clock: () => f.clock.value, random: () => 0.5,
      sleep: async ms => { f.clock.value += ms; }, budgets: trainingRecipe.budget, readBytes: execution.readBytes,
      resolveExamples: async () => ({ template: datasetOptions().template, variables: [{ experienceId: fixture.experience.id, ...selectionText(0) }] }),
      compileDag, pollInterval: 5, leaseMs: 300000, onOutcome: (event: JobOutcome) => {
        if (event.outcome === 'completed') completed.add(event.jobId);
        if (completed.size === plans.length) done.resolve();
        else if (event.attempt > 12) done.reject(Error('Native stale-parent execution exhausted its attempts.'));
      } });
    worker.start(); await done.promise; assert.equal((await worker.stop({ graceMs: 1000 })).drained, true); worker = undefined;
    assert.equal(execution.stats().submitRequests, mode === 'rebase' ? 1 : 0);
    assert.equal(accepted(await f.store().get('training_runs', plans[0].run.id))?.state, 'cancelled');
    if (mode === 'rebase') assert.equal(accepted(await f.store().get('training_runs', plans[1].run.id))?.state, 'complete');
    assert.deepEqual(accepted(await f.store().head('fixture-profile', 'fixture')), head);
    assert.deepEqual(accepted(await f.store().list('approvals', 'fixture')), approvals);
    measurements[mode] = { action: result.action, cancelled: result.counts.cancelled, rebased: result.counts.rebased, submissions: execution.stats().submissions };
    cases.push('stale-parent-native-' + mode);
  } finally { await worker?.stop({ graceMs: 1000 }); await runner?.close(); await f.close(); }
}

{
  const f = await rig('foreground'); let runner: Awaited<ReturnType<typeof createExperientialRunner>> | undefined, worker: JobWorker | undefined;
  const release = deferred();
  try {
    const prepared = await trainingFixture(f.store(), f.clock);
    const deployment = accepted(await createExperientialDeployment({ profile: 'training-profile', scope: prepared.base.scope, candidateId: 'fake-base',
      baseArtifact: prepared.base, recordedAt: SELECTION_TIME, operationalLimits: { maxFailureRate: 0, maxP95Ms: 100, window: 10 } }));
    accepted(await f.store().put('deployments', deployment));
    runner = await createExperientialRunner({ store: f.store(), backend: prepared.backend, recipe: recipe(deployment.profile, prepared.base.runtime),
      jobs: { enqueue: plan => enqueueExperientialTraining(f.db, plan) }, now: () => f.clock.value, sleep: prepared.context.sleep, policy });
    accepted(await runner.run({ scope: prepared.base.scope, kind: 'manual', key: 'foreground' }));
    const training = deferred(), done = deferred(); let blocked = false;
    const backend = { ...prepared.backend, inspect: async (id: string) => {
      const result = await prepared.backend.inspect(id);
      if (result.ok && result.value.state === 'training') { blocked = true; training.resolve(); await release.promise; blocked = false; }
      return result;
    } };
    worker = await createExperientialTrainingRunner(f.db, { ...prepared.context, backend, compileDag, pollInterval: 5, leaseMs: 300000,
      onOutcome: event => { if (event.outcome === 'completed') done.resolve(); else if (event.attempt > 12) done.reject(Error('Foreground training did not complete.')); } });
    worker.start(); await training.promise; const at = f.clock.value;
    const memory = createDbMemoryStore(f.db.collection('memories')), embedder = createHashEmbedder({ dims: 64 });
    const text = 'Foreground memory remains available while the fake trainer is blocked.';
    const [embedding] = await embedder.embed([text]);
    const unit = { ...createMemoryUnit({ text, evidence: 'foreground-conformance', at: new Date(at).toISOString() }),
      embedding: Array.from(embedding), embeddedBy: { model: embedder.model, dims: 64 } };
    await memory.put(unit); const listed = await memory.list(); assert.equal(listed.length, 1);
    assert.equal(recallByEmbedding(listed, embedding, { identity: unit.embeddedBy }).ranked[0].unit.id, unit.id);
    const ingester = createDocumentIngester({ store: createDocumentStore(f.db), embedder, now: () => new Date(f.clock.value).toISOString(),
      fetcher: new SafeStaticFetcher({ lookup: async () => [{ address: '93.184.216.34', family: 4 }], limits: { respectRobots: false, perHostDelayMs: 0 },
        fetch: async () => new Response('<html><body><main><h1>Availability</h1><p>The foreground document is ingested while the independent fake training job remains blocked.</p></main></body></html>', { headers: { 'content-type': 'text/html' } }) }) });
    assert.equal((await ingester.ingest({ url: 'https://docs.example/availability' })).status, 'ingested');
    assert.equal(blocked, true); assert.equal(f.clock.value, at);
    measurements.foreground = { clockMs: f.clock.value - at, memoryWrites: 1, memoryReads: 1, memoryRecalls: 1, documentIngests: 1, trainingStillBlocked: true };
    release.resolve(); await done.promise; assert.equal((await worker.stop({ graceMs: 1000 })).drained, true); worker = undefined;
    assert.equal(prepared.backend.stats().submissions, 1); cases.push('foreground-during-native-training');
  } finally { release.resolve(); await worker?.stop({ graceMs: 1000 }); await runner?.close(); await f.close(); }
}

for (const [target, occurrence] of [['put:experiential_training_runs', 1], ['put:experiential_events', 1], ['put:experiential_events', 2], ['commit', 1]] as const) {
  const f = await rig('admission-' + target.replaceAll(':', '-') + occurrence); let runner: Awaited<ReturnType<typeof createExperientialRunner>> | undefined;
  try {
    const fixture = await experientialStoreFixture(f.store()); f.clock.value += 1000;
    const backend = createFakeTrainingBackend({ seed: 17753, clock: () => f.clock.value, baseModels: [fixture.artifact.id], runtime: fixture.base.runtime });
    runner = await createExperientialRunner({ store: f.store(), backend, recipe: recipe('fixture-profile', fixture.base.runtime), policy,
      jobs: { enqueue: plan => enqueueExperientialTraining(f.db, plan) }, now: () => f.clock.value, sleep: async ms => { f.clock.value += ms; } });
    const trigger = { scope: 'fixture', kind: 'manual' as const, key: 'atomic-reservation' }, before = await f.state('fixture');
    f.setFault(target, occurrence); assert.equal((await runner.run(trigger)).ok, false); f.setFault(null);
    assert.deepEqual(await f.state('fixture'), before); assert.equal((await f.db.jobs!.counts()).pending, 0);
    assert.equal(accepted(await runner.run(trigger)).action, 'enqueued'); assert.equal((await f.db.jobs!.counts()).pending, 1);
    assert.equal(backend.stats().submitRequests, 0); cases.push('admission-atomic-' + target + '-' + occurrence);
  } finally { await runner?.close(); await f.close(); }
}

for (const target of ['put:experiential_retention_decisions', 'put:experiential_experiences', 'put:experiential_events', 'commit']) {
  const f = await rig('retention-' + target.replaceAll(':', '-'));
  try {
    const fixture = await retentionFixture(f.store()), plan = accepted(await planExperientialRetention(await fixture.snapshot()));
    const before = await f.state('fixture'); f.setFault(target);
    assert.equal((await f.store().retain(plan)).ok, false); f.setFault(null); assert.deepEqual(await f.state('fixture'), before);
    accepted(await f.store().retain(plan)); const retained = await f.state('fixture'); await f.reopen();
    const retry = await f.store().retain(plan); assert.ok(retry.ok); assert.equal(retry.writes, 0);
    assert.deepEqual(await f.state('fixture'), retained);
    assert.equal(accepted(await resolveExperientialLineage(f.store(), fixture.artifact.id)).experiences[0].state, 'archived');
    cases.push('retention-atomic-reopen-' + target);
  } finally { await f.close(); }
}

assert.equal(physicalRequests, 0);
console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', cases, passed: cases.length, failed: 0,
  physicalRequests, scientificApproval: 'not-claimed', measurements }));
