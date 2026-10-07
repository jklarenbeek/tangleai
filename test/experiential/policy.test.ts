import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createExperientialRunner, DEFAULT_EXPERIENTIAL_TRIGGER_POLICY, sealExperientialTriggerPolicy,
  createExperientialTrainingTasks, planExperientialRollback, type ExperientialStore, type ExperientialTriggerPolicy } from '@tangleai/experiential';
import { accepted, addressedFixture } from './identity-fixtures.ts';
import { cadenceFixture, activeCadenceFixture } from './policy-fixtures.ts';
import { datasetOptions } from './dataset-fixtures.ts';
import { selectionText } from './selection-fixtures.ts';

it('defaults to disabled and touches neither persistence nor the queue during creation or a disabled tick', async () => {
  assert.equal(DEFAULT_EXPERIENTIAL_TRIGGER_POLICY.enabled, false);
  const f = await cadenceFixture();
  const forbidden = new Proxy({}, { get() { throw Error('No disabled side effect is permitted.'); } });
  const runner = await createExperientialRunner({ ...f.options, store: forbidden as ExperientialStore,
    jobs: forbidden as typeof f.binding, policy: undefined });
  try {
    const result = accepted(await runner.run(f.trigger)); assert.equal(result.action, 'no-op'); assert.equal(result.reason, 'disabled');
    assert.equal(runner.stats().byReason.disabled, 1); assert.equal(f.jobs.size, 0);
  } finally { await runner.close(); await f.close(); }
});

it('derives completion cooldown from the durable transition event for an older retained run', async () => {
  const f = await activeCadenceFixture({ scopeCooldownMs: 2000 });
  try {
    const result = accepted(await f.runner.run(f.trigger));
    assert.equal(result.action, 'no-op'); assert.equal(result.reason, 'cooldown'); assert.equal(f.jobs.size, 0);
    assert.equal(f.runner.stats().byReason.cooldown, 1);
  } finally { await f.close(); }
});

for (const action of ['cancel', 'rebase'] as const) it('counts and persists a stale queued parent under the ' + action + ' policy', async () => {
  const f = await activeCadenceFixture({ onStaleParent: action });
  try {
    const first = accepted(await f.runner.run(f.trigger)), original = f.jobs.get(first.jobId!)!;
    const moved = await f.moveHead(), head = accepted(await f.store.head('fixture-profile', 'fixture'));
    const approvals = accepted(await f.store.list('approvals', 'fixture'));
    const result = accepted(await f.runner.run(f.trigger));
    assert.equal(result.action, action === 'cancel' ? 'cancelled' : 'rebased'); assert.equal(result.counts.cancelled, 1);
    assert.equal(accepted(await f.store.get('training_runs', original.run.id))?.state, 'cancelled');
    if (action === 'rebase') {
      assert.notEqual(result.jobId, first.jobId); assert.equal(f.jobs.get(result.jobId!)?.run.baseArtifactId, moved.artifact.id);
      assert.equal(result.counts.rebased, 1);
    } else assert.equal(result.jobId, null);
    assert.deepEqual(accepted(await f.store.head('fixture-profile', 'fixture')), head);
    assert.deepEqual(accepted(await f.store.list('approvals', 'fixture')), approvals);
    const writes = f.store.stats().writes;
    assert.equal(accepted(await f.runner.run(f.trigger)).action, 'replayed'); assert.equal(f.store.stats().writes, writes);
    assert.equal(f.backend.stats().submissions, 0);
  } finally { await f.close(); }
});

it('fences a prepared job before submission and lets the next tick rebase that durable cancellation', async () => {
  const f = await activeCadenceFixture({ onStaleParent: 'rebase' });
  try {
    const first = accepted(await f.runner.run(f.trigger)), plan = f.jobs.get(first.jobId!)!;
    const tasks = createExperientialTrainingTasks({ store: f.store, backend: f.backend, clock: () => f.clock.value, random: () => 0.5,
      sleep: f.options.sleep, budgets: f.recipe.budget, readBytes: f.backend.readBytes,
      resolveExamples: async () => ({ template: datasetOptions().template, variables: [{ experienceId: f.fixture.experience.id, ...selectionText(0) }] }) });
    await tasks.select.run({ input: plan.input }); await tasks.render.run({ input: plan.input });
    const moved = await f.moveHead(); await tasks.submit.run({ input: plan.input });
    assert.equal(f.backend.stats().submitRequests, 0);
    assert.equal(accepted(await f.store.get('training_runs', plan.run.id))?.state, 'cancelled');
    const result = accepted(await f.runner.run(f.trigger)); assert.equal(result.action, 'rebased');
    assert.equal(result.counts.cancelled, 0); assert.equal(f.jobs.get(result.jobId!)?.run.baseArtifactId, moved.artifact.id);
  } finally { await f.close(); }
});

it('cancels the stale reservation after a deployment moves away and returns to the same parent', async () => {
  const f = await activeCadenceFixture({ onStaleParent: 'cancel' });
  try {
    const first = accepted(await f.runner.run(f.trigger)), plan = f.jobs.get(first.jobId!)!;
    await f.moveHead();
    const head = accepted(await f.store.head('fixture-profile', 'fixture'));
    const deployment = accepted(await f.store.get('deployments', f.fixture.servingDeployment.id))!;
    const artifact = accepted(await f.store.get('artifacts', f.fixture.artifact.id))!;
    const reason = 'Restore the prior synthetic parent while preserving the changed revision.';
    const approval = await addressedFixture('approval', { ...f.fixture.approval, action: 'rollback', reason,
      expectedHead: head.head, expectedDeploymentRevision: deployment.revision });
    accepted(await f.store.put('approvals', approval));
    accepted(await f.store.rollback(accepted(planExperientialRollback({ head, deployment, artifact,
      evaluation: f.fixture.evaluation, approval, reason }))));
    assert.equal(accepted(await f.store.head('fixture-profile', 'fixture')).head.versionId, plan.run.baseArtifactId);
    const result = accepted(await f.runner.run(f.trigger)); assert.equal(result.action, 'cancelled');
    assert.equal(result.counts.cancelled, 1); assert.equal(f.jobs.size, 1); assert.equal(f.backend.stats().submitRequests, 0);
    assert.equal(accepted(await f.store.get('training_runs', plan.run.id))?.state, 'cancelled');
  } finally { await f.close(); }
});

it('twenty concurrent duplicate ticks reserve one run, and restart replays without domain writes or authority changes', async () => {
  const f = await cadenceFixture();
  try {
    const approvals = accepted(await f.store.list('approvals', f.base.scope)), head = accepted(await f.store.head(f.deployment.profile, f.base.scope));
    const rows = await Promise.all(Array.from({ length: 20 }, () => f.runner.run(f.trigger).then(accepted)));
    assert.equal(rows.filter(row => row.action === 'enqueued').length, 1); assert.equal(rows.filter(row => row.action === 'replayed').length, 19);
    assert.equal(f.jobs.size, 1); assert.equal(accepted(await f.store.list('training_runs', f.base.scope)).length, 1);
    assert.equal(f.backend.stats().submissions, 0);
    assert.deepEqual(accepted(await f.store.list('approvals', f.base.scope)), approvals);
    assert.deepEqual(accepted(await f.store.head(f.deployment.profile, f.base.scope)), head);
    const writes = f.store.stats().writes, next = await createExperientialRunner(f.options);
    try { assert.equal(accepted(await next.run(f.trigger)).action, 'replayed'); assert.equal(f.store.stats().writes, writes); }
    finally { await next.close(); }
    assert.equal(f.jobs.size, 1);
  } finally { await f.close(); }
});

it('different concurrent keys obey one durable cadence window', async () => {
  const f = await cadenceFixture();
  try {
    const rows = await Promise.all(Array.from({ length: 20 }, (_, i) => f.runner.run({ ...f.trigger, key: 'tick-' + i }).then(accepted)));
    assert.equal(rows.filter(row => row.action === 'enqueued').length, 1);
    assert.equal(rows.filter(row => row.reason === 'cadence').length, 19); assert.equal(f.jobs.size, 1);
    assert.equal(f.runner.stats().byReason.cadence, 19);
  } finally { await f.close(); }
});

it('counts the minimum, time, spend, daily-run and durable-queue no-op boundaries', async () => {
  const cases: Array<{ policy: Partial<Omit<ExperientialTriggerPolicy, 'revision'>>; kind?: 'count' | 'time'; reason: string; prime?: boolean }> = [
    { policy: { minimumEligible: 3 }, kind: 'count', reason: 'below-minimum' },
    { policy: {}, kind: 'time', reason: 'cadence' },
    { policy: { computeBudget: { maxRunsPerDay: 0, maxSpend: null } }, reason: 'budget-exhausted' },
    { policy: { computeBudget: { maxRunsPerDay: 1, maxSpend: 0 } }, reason: 'budget-exhausted' },
    { policy: { maxQueued: 1 }, reason: 'queue-full', prime: true },
  ];
  for (const row of cases) {
    const f = await cadenceFixture(row.policy);
    try {
      if (row.prime) accepted(await f.runner.run(f.trigger));
      const result = accepted(await f.runner.run({ ...f.trigger, key: 'measured', kind: row.kind ?? 'manual' }));
      assert.equal(result.action, 'no-op'); assert.equal(result.reason, row.reason);
      assert.equal(f.runner.stats().byReason[row.reason as keyof ReturnType<typeof f.runner.stats>['byReason']], 1);
      assert.equal(f.jobs.size, row.prime ? 1 : 0);
    } finally { await f.close(); }
  }
});

it('refuses an outcome without the exact independently approved source and rejects clock regression before any new effect', async () => {
  const f = await cadenceFixture();
  try {
    assert.equal(accepted(await f.runner.run({ ...f.trigger, kind: 'outcome', key: 'invented-outcome' })).reason, 'no-approved-dataset');
    assert.equal(f.runner.stats().byReason['no-approved-dataset'], 1);
    const row = accepted(await f.runner.run(f.trigger)); assert.equal(row.action, 'enqueued');
    const writes = f.store.stats().writes; f.clock.value--;
    const skew = accepted(await f.runner.run(f.trigger)); assert.equal(skew.reason, 'clock-skew'); assert.equal(skew.issue?.code, 'TEXP1009');
    assert.equal(f.store.stats().writes, writes); assert.equal(f.runner.stats().byReason['clock-skew'], 1);
    const restarted = await createExperientialRunner(f.options);
    try { assert.equal(accepted(await restarted.run(f.trigger)).reason, 'clock-skew'); } finally { await restarted.close(); }
  } finally { await f.close(); }
});

it('admits an exact approved outcome and lets manual triggers bypass only the count threshold', async () => {
  for (const kind of ['outcome', 'manual'] as const) {
    const f = await cadenceFixture({ minimumEligible: 100 });
    try {
      const [experience] = accepted(await f.store.list('experiences', f.base.scope));
      const key = kind === 'outcome' ? experience.observedOutcome!.sourceId : 'manual-below-count';
      assert.equal(accepted(await f.runner.run({ ...f.trigger, kind, key })).action, 'enqueued');
      assert.equal(f.jobs.size, 1); assert.equal(accepted(await f.store.list('approvals', f.base.scope)).length, 0);
      assert.equal(accepted(await f.store.head(f.deployment.profile, f.base.scope)).head.revision, 0);
    } finally { await f.close(); }
  }
});

it('counts non-integer and non-finite clock observations without reserving or queueing work', async () => {
  const f = await cadenceFixture();
  try {
    const writes = f.store.stats().writes;
    for (const value of [f.clock.value + 0.5, NaN, Infinity, -1]) {
      f.clock.value = value;
      const result = accepted(await f.runner.run(f.trigger));
      assert.equal(result.reason, 'clock-skew'); assert.equal(result.issue?.code, 'TEXP1009');
    }
    assert.equal(f.runner.stats().byReason['clock-skew'], 4); assert.equal(f.store.stats().writes, writes); assert.equal(f.jobs.size, 0);
  } finally { await f.close(); }
});

it('resumes a failed enqueue from its retained reservation without repurchasing budget', async () => {
  const f = await cadenceFixture({ computeBudget: { maxRunsPerDay: 1, maxSpend: null } });
  const broken = await createExperientialRunner({ ...f.options, jobs: { async enqueue() { throw Error('Injected queue outage.'); } } });
  try {
    const failure = await broken.run(f.trigger); assert.equal(failure.ok, false);
    const writes = f.store.stats().writes;
    assert.equal(accepted(await f.runner.run(f.trigger)).action, 'replayed'); assert.equal(f.jobs.size, 1);
    assert.equal(f.store.stats().writes, writes); assert.equal(accepted(await f.store.list('training_runs', f.base.scope)).length, 1);
  } finally { await broken.close(); await f.close(); }
});

it('counts a durable cancellation and rebase even when the native queue is temporarily unavailable', async () => {
  const f = await activeCadenceFixture({ onStaleParent: 'rebase' });
  const broken = await createExperientialRunner({ ...f.options, jobs: { async enqueue() { throw Error('Injected queue outage after rebase.'); } } });
  try {
    const first = accepted(await f.runner.run(f.trigger)), original = f.jobs.get(first.jobId!)!;
    await f.moveHead();
    assert.equal((await broken.run(f.trigger)).ok, false);
    assert.equal(accepted(await f.store.get('training_runs', original.run.id))?.state, 'cancelled');
    assert.equal(broken.stats().cancelled, 1); assert.equal(broken.stats().rebased, 1);
    assert.equal(broken.stats().enqueued, 0);
    const writes = f.store.stats().writes;
    assert.equal(accepted(await f.runner.run(f.trigger)).action, 'replayed');
    assert.equal(f.store.stats().writes, writes); assert.equal(f.jobs.size, 2);
    assert.equal(f.backend.stats().submitRequests, 0);
  } finally { await broken.close(); await f.close(); }
});

it('hashes the closed policy and refuses changed bytes or a changed recipe under an already reserved trigger key', async () => {
  const f = await cadenceFixture();
  try {
    const policy = accepted(await sealExperientialTriggerPolicy({ ...DEFAULT_EXPERIENTIAL_TRIGGER_POLICY, ...f.options.policy }));
    await assert.rejects(createExperientialRunner({ ...f.options, policy: { ...policy, minimumEligible: 3 } }), TypeError);
    accepted(await f.runner.run(f.trigger));
    const changed = await createExperientialRunner({ ...f.options, recipe: { ...f.recipe, seed: f.recipe.seed + 1 } });
    try { const result = await changed.run(f.trigger); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.issues[0].code, 'TEXP1002'); }
    finally { await changed.close(); }
    assert.equal(f.jobs.size, 1);
  } finally { await f.close(); }
});

it('captures the training recipe before asynchronous policy hashing yields', async () => {
  const f = await cadenceFixture();
  try {
    const recipe = structuredClone(f.recipe), expected = recipe.seed;
    const pending = createExperientialRunner({ ...f.options, recipe }); recipe.seed++;
    const runner = await pending;
    try {
      const result = accepted(await runner.run(f.trigger)); assert.equal(f.jobs.get(result.jobId!)?.run.spec?.seed, expected);
    } finally { await runner.close(); }
  } finally { await f.close(); }
});

it('bounds the scheduler queue and drains the active enqueue before close settles', async () => {
  const f = await cadenceFixture();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), blocked = new Promise<void>(resolve => { release = resolve; });
  const runner = await createExperientialRunner({ ...f.options, policy: { ...f.options.policy, concurrency: 1, maxQueue: 1 },
    jobs: { async enqueue(plan) { entered(); await blocked; return f.binding.enqueue(plan); } } });
  try {
    const first = runner.run(f.trigger); await started;
    const second = runner.run({ ...f.trigger, key: 'queued' });
    assert.equal(accepted(await runner.run({ ...f.trigger, key: 'overflow' })).reason, 'queue-full');
    let closed = false; const closing = runner.close().then(() => { closed = true; });
    assert.equal(accepted(await second).reason, 'closed'); assert.equal(closed, false);
    release(); assert.equal(accepted(await first).action, 'enqueued'); await closing; assert.equal(closed, true);
    assert.equal(runner.stats().byReason['queue-full'], 1); assert.equal(f.jobs.size, 1);
  } finally { release(); await runner.close(); await f.close(); }
});
