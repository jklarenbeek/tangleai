/** Terminal interactions and attempt ownership are atomic native store boundaries. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMasConfigCatalog, createMasRegistrySnapshot, validateMasWorkflow, planMasWorkflow,
  planNodeCompletion, type BeginAttemptPlan, type CommitCompletionPlan, type MasStore,
  type MasWorkflow, type RuntimeError, type StoreOutcome } from '@tangleai/mas';
import { openTangleDb, createMasStore, ensurePendingMasSegments, createMasSegmentDriver } from '@tangleai/store';

const read = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'));
const fixture = await read('benchmark/fixtures/mas/control/peer-review.json') as { workflow: MasWorkflow };
const registration = await read('benchmark/fixtures/mas/manifest.json') as { configCatalog: { path: string } };
const registry = await createMasRegistrySnapshot(await read('benchmark/fixtures/mas/control-registry.json'));
const catalog = await createMasConfigCatalog(await read(registration.configCatalog.path));
assert.ok(registry.valid && catalog.valid);
const validated = await validateMasWorkflow(fixture.workflow, registry.value, catalog.value); assert.ok(validated.valid);
const planned = await planMasWorkflow(validated.value); assert.ok(planned.valid);
const version = { workflowId: fixture.workflow.workflowId, workflowVersionId: fixture.workflow.versionId,
  registryRevision: registry.value.revision, executableRevision: planned.value.executableRevision,
  configRegistryRevision: catalog.value.revision, profile: fixture.workflow.config.profile };
const failure: RuntimeError = { code: 'TMAS2007', detail: 'The interaction was resolved without approval.', cause: null };
function value<T>(outcome: StoreOutcome<T>): T { assert.ok(outcome.ok, JSON.stringify(outcome)); return outcome.value; }
function refused(outcome: StoreOutcome<unknown>, code: string) {
  assert.equal(outcome.ok, false, JSON.stringify(outcome)); if (!outcome.ok) assert.equal(outcome.issue.code, code);
}
async function run(store: MasStore, id: string) {
  value(await store.createRun({ ...version, runId: id, input: { draft: 'v1' }, limits: { calls: 10, tokens: 1000, ms: 10000 } }));
  return value(await store.claimRunSegment(id, 'owner'));
}
function begin(runId: string, path = 'draft'): BeginAttemptPlan {
  return { runId, path, invocationId: path, kind: 'task', idempotencyKey: runId + '/dag0//0/' + path, claimSeq: 1 };
}
function completion(runId: string, attemptId: string): CommitCompletionPlan {
  return { runId, attemptId, claimSeq: 1, output: { text: 'draft' }, messages: [], state: null,
    spend: { turns: 1, tokens: 1, ms: 0 }, usage: { calls: 1, toolCalls: 0, contextReads: 0, promptTokens: 1, completionTokens: 0 },
    stopReason: 'stop', transcript: { state: 'not-run', text: null, size: 0, artifact: null },
    toolSteps: [], contextReads: [], artifacts: [], restored: false };
}
async function wait(store: MasStore, id: string, expiry: { afterMs: number; deadline: string } | null = null) {
  await run(store, id);
  const interaction = value(await store.createInteraction({ runId: id, node: 'review', path: 'review', prompt: 'v1',
    responseSchema: { type: 'string', const: 'approve-v1' }, expiry, segment: 0 }));
  value(await store.transitionRun(id, { kind: 'wait' })); return interaction;
}

for (const status of ['expired', 'cancelled'] as const) it(`${status} interaction atomically fails a waiting run without approval or a resume job, across reopen`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mas-terminal-')), path = join(dir, 'run.sqlite');
  const open = () => openTangleDb({ path, jobs: { now: () => 1000, random: () => 0.5 } });
  let db = await open();
  try {
    let store = createMasStore(db, { now: () => '2026-10-03T00:00:00Z' });
    const gate = await wait(store, 'terminal-' + status);
    value(await store.resolveInteraction(gate.id, status, gate.revision));
    await db.close(); db = await open(); store = createMasStore(db);
    const trace = await store.readTrace(gate.runId); assert.ok(trace);
    assert.equal(trace.run.status, 'failed'); assert.equal(trace.run.failure?.error.code, 'TMAS2007');
    assert.equal(trace.interactions[0].status, status); assert.equal(trace.interactions[0].response, null);
    assert.equal(trace.interactions[0].resumeSegment, null);
    assert.deepEqual(await ensurePendingMasSegments(db, store), { examined: 0, enqueued: 0, queued: 0, skipped: 0 });
    refused(await store.respondInteraction(gate.id, 'approve-v1', gate.revision, 'late'), 'TMAS2007');
    assert.deepEqual(await store.readTrace(gate.runId), trace);
    assert.equal((await db.jobs!.counts()).pending, 0);
  } finally { await db.close(); await rm(dir, { recursive: true, force: true }); }
});

it('a late response expires the interaction and fails the run in the same transaction', async () => {
  const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } });
  let now = '2026-10-03T00:00:00Z'; const store = createMasStore(db, { now: () => now });
  try {
    const gate = await wait(store, 'late-response', { afterMs: 1000, deadline: '2026-10-03T00:00:01Z' });
    now = '2026-10-03T00:00:02Z';
    refused(await store.respondInteraction(gate.id, 'approve-v1', 0, 'late'), 'TMAS2007');
    assert.equal((await store.getInteraction(gate.id))?.status, 'expired');
    assert.equal((await store.getRun(gate.runId))?.status, 'failed');
    assert.equal((await store.getRun(gate.runId))?.failure?.error.code, 'TMAS2007');
    assert.equal((await ensurePendingMasSegments(db, store)).enqueued, 0);
  } finally { await db.close(); }
});

for (const late of [false, true]) it(`terminal interaction writes roll back together${late ? ' on lazy expiry' : ''}`, async () => {
  const db = await openTangleDb(); let failAt = '', now = '2026-10-03T00:00:00Z';
  const store = createMasStore(db, { now: () => now, applyProbe: step => { if (step === failAt) throw Error('injected terminal boundary'); } });
  try {
    const gate = await wait(store, 'atomic-stop', late ? { afterMs: 1000, deadline: '2026-10-03T00:00:01Z' } : null);
    now = '2026-10-03T00:00:02Z'; const before = await store.readTrace(gate.runId);
    for (const step of ['interaction', 'interaction-run', 'interaction-commit']) {
      failAt = step;
      await assert.rejects(late ? store.respondInteraction(gate.id, 'approve-v1', 0, 'late') : store.resolveInteraction(gate.id, 'expired', 0), /injected terminal boundary/);
      assert.deepEqual(await store.readTrace(gate.runId), before);
    }
    failAt = ''; value(await store.resolveInteraction(gate.id, 'expired', 0));
    assert.equal((await store.getRun(gate.runId))?.status, 'failed');
  } finally { await db.close(); }
});

for (const first of ['respond', 'expire'] as const) it(`concurrent ${first} admission has one winner and no partial interaction/run pair`, async () => {
  const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } });
  const a = createMasStore(db, { now: () => '2026-10-03T00:00:00Z' }), b = createMasStore(db, { now: () => '2026-10-03T00:00:01Z' });
  try {
    const gate = await wait(a, 'race-' + first);
    const respond = () => a.respondInteraction(gate.id, 'approve-v1', 0, 'winner');
    const expire = () => b.resolveInteraction(gate.id, 'expired', 0);
    const outcomes = await Promise.all(first === 'respond' ? [respond(), expire()] : [expire(), respond()]);
    assert.equal(outcomes.filter(outcome => outcome.ok).length, 1);
    const interaction = await a.getInteraction(gate.id), current = await a.getRun(gate.runId); assert.ok(interaction && current);
    assert.equal(current.status, interaction.status === 'responded' ? 'resume_pending' : 'failed');
    const queued = await ensurePendingMasSegments(db, a);
    assert.equal(queued.enqueued, interaction.status === 'responded' ? 1 : 0);
    assert.equal((await ensurePendingMasSegments(db, b)).enqueued, 0);
    assert.equal(interaction.response, interaction.status === 'responded' ? 'approve-v1' : null);
  } finally { await db.close(); }
});

for (const terminal of ['complete', 'fail', 'cancel'] as const) it(`${terminal} fences new semantic writes but preserves exact committed replay`, async () => {
  const db = await openTangleDb(), store = createMasStore(db, { now: () => 'fixed' });
  try {
    const id = 'fence-' + terminal; await run(store, id);
    const ready = await store.beginNodeAttempt(begin(id)); assert.equal(ready.kind, 'started'); if (ready.kind !== 'started') return;
    const plan = completion(id, ready.attempt.id); value(await store.commitNodeCompletion(plan));
    const pending = await store.beginNodeAttempt(begin(id, 'pending')); assert.equal(pending.kind, 'started'); if (pending.kind !== 'started') return;
    value(await store.putRunFsm(id, 'control', { state: 'ready', context: {} }));
    value(await store.transitionRun(id, terminal === 'complete' ? { kind: 'complete', output: {} }
      : terminal === 'fail' ? { kind: 'fail', failure: { node: null, error: failure } } : { kind: 'cancel' }));
    const before = await store.readTrace(id);
    assert.equal((await store.beginNodeAttempt(begin(id))).kind, 'completed');
    value(await store.commitNodeCompletion(plan));
    const fresh = await store.beginNodeAttempt(begin(id, 'late')); assert.equal(fresh.kind, 'refused');
    if (fresh.kind === 'refused') assert.equal(fresh.issue.code, 'TMAS2003');
    refused(await store.commitNodeCompletion(completion(id, pending.attempt.id)), 'TMAS2003');
    refused(await store.failNodeAttempt({ runId: id, attemptId: pending.attempt.id, claimSeq: 1, status: 'failed', error: failure, receipt: plan }), 'TMAS2003');
    refused(await store.putRunFsm(id, 'control', { state: 'changed', context: {} }), 'TMAS2003');
    refused(await store.createInteraction({ runId: id, node: 'late', path: 'late', prompt: null, responseSchema: true, expiry: null, segment: 0 }), 'TMAS2003');
    assert.deepEqual(await store.readTrace(id), before);
  } finally { await db.close(); }
});

it('completion and failure refuse another run’s attempt, including the completed replay path', async () => {
  const db = await openTangleDb(), store = createMasStore(db, { now: () => 'fixed' });
  try {
    await run(store, 'owner-a'); await run(store, 'owner-b');
    const begun = await store.beginNodeAttempt(begin('owner-b')); assert.equal(begun.kind, 'started'); if (begun.kind !== 'started') return;
    const plan = completion('owner-a', begun.attempt.id), before = await Promise.all(['owner-a', 'owner-b'].map(id => store.readTrace(id)));
    refused(planNodeCompletion(begun.attempt, plan, { nextSeq: 1, now: 'fixed', stateParent: null }), 'TMAS2002');
    refused(await store.commitNodeCompletion(plan), 'TMAS2002');
    refused(await store.failNodeAttempt({ runId: 'owner-a', attemptId: begun.attempt.id, claimSeq: 1, status: 'failed', error: failure, receipt: plan }), 'TMAS2002');
    assert.deepEqual(await Promise.all(['owner-a', 'owner-b'].map(id => store.readTrace(id))), before);
    value(await store.commitNodeCompletion({ ...plan, runId: 'owner-b' }));
    const committed = await Promise.all(['owner-a', 'owner-b'].map(id => store.readTrace(id)));
    refused(await store.commitNodeCompletion(plan), 'TMAS2002');
    assert.deepEqual(await Promise.all(['owner-a', 'owner-b'].map(id => store.readTrace(id))), committed);
  } finally { await db.close(); }
});

it('a semantic key cannot replay a different path, invocation or kind', async () => {
  const db = await openTangleDb(), store = createMasStore(db);
  try {
    await run(store, 'key-owner'); const key = begin('key-owner');
    const started = await store.beginNodeAttempt(key); assert.equal(started.kind, 'started'); if (started.kind !== 'started') return;
    value(await store.commitNodeCompletion(completion(key.runId, started.attempt.id)));
    const before = await store.readTrace(key.runId);
    for (const changed of [{ path: 'different' }, { invocationId: 'different' }, { kind: 'agent' as const }]) {
      const result = await store.beginNodeAttempt({ ...key, ...changed });
      assert.equal(result.kind, 'refused'); if (result.kind === 'refused') assert.equal(result.issue.code, 'TMAS2001');
    }
    assert.deepEqual(await store.readTrace(key.runId), before);
  } finally { await db.close(); }
});

it('a cancelled queued segment settles on reclaim without executing its body', async () => {
  const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } }), store = createMasStore(db);
  try {
    const current = value(await store.createRun({ ...version, runId: 'cancelled-segment', input: { draft: 'v1' }, limits: {} }));
    const driver = createMasSegmentDriver(db, store, { owner: 'test', leaseMs: 1000 });
    await driver.enqueue(current); value(await store.transitionRun(current.id, { kind: 'cancel' }));
    let calls = 0;
    assert.equal(await driver.drive(version.executableRevision, async () => { calls++; }, new AbortController().signal), true);
    assert.equal(calls, 0); assert.equal(await driver.settled((await store.getRun(current.id))!), true);
    assert.equal((await db.jobs!.counts()).failed, 0);
  } finally { await db.close(); }
});
