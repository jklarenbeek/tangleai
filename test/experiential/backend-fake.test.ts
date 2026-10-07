import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeTrainingBackend, verifyArtifactReceipt, type FakeTrainingBackend } from '@tangleai/experiential';
import { validateExperientialShape } from '../../packages/experiential/src/schema.ts';
import { backendFixture } from './backend-fixtures.ts';
import { accepted } from './identity-fixtures.ts';

async function complete(backend: FakeTrainingBackend, id: string, polls = 4) {
  const states: string[] = [];
  for (let i = 0; i < polls; i++) states.push(accepted(await backend.inspect(id)).state);
  return states;
}
it('the fake service is deterministic, idempotent under concurrent submission and never sleeps', async () => {
  const { spec, receipt } = await backendFixture(); let at = 10;
  const options = { seed: 17753, stepsPerState: 1, clock: () => at++, baseModels: [spec.baseArtifactId], runtime: receipt.runtime };
  const one = createFakeTrainingBackend(options), two = createFakeTrainingBackend(options);
  const jobs = await Promise.all(Array.from({ length: 20 }, () => one.submit(spec)));
  assert.equal(new Set(jobs.map(value => accepted(value).id)).size, 1); assert.equal(one.stats().submissions, 1);
  assert.equal(one.stats().submitRequests, 20);
  const job = accepted(jobs[0]!), other = accepted(await two.submit(spec)); assert.deepEqual(job, other);
  assert.deepEqual(await complete(one, job.id), ['preparing', 'training', 'materializing', 'complete']);
  assert.deepEqual(await complete(two, other.id), ['preparing', 'training', 'materializing', 'complete']);
  const a = accepted(await one.materialize(job.id)), b = accepted(await two.materialize(other.id));
  assert.equal(a.sha256, b.sha256); assert.equal(a.deterministic, true);
  assert.equal(accepted(await verifyArtifactReceipt(a, { spec, job, runtime: receipt.runtime, maxBytes: 4096, readBytes: one.readBytes })).receipt.sha256, a.sha256);
  assert.ok(one.stats().lastObservedAt !== null);
  const bytes = await one.readBytes(a, 4096), original = bytes.slice(); bytes.fill(0);
  assert.deepEqual(await one.readBytes(a, 4096), original);
  assert.equal(JSON.parse(new TextDecoder().decode(original)).format, 'tangle-fake-adapter/1');
});

it('fake failures, cancellation and checksum corruption remain visible and cannot materialize usable bytes', async () => {
  const { spec, receipt } = await backendFixture();
  const options = { seed: 1, clock: () => 10, baseModels: [spec.baseArtifactId], runtime: receipt.runtime };
  const failed = createFakeTrainingBackend({ ...options, failAt: 'training' });
  const failure = accepted(await failed.submit(spec));
  assert.deepEqual(await complete(failed, failure.id), ['preparing', 'failed', 'failed', 'failed']);
  assert.equal(accepted(await failed.inspect(failure.id)).stopReason, 'scripted-training-failure');
  assert.equal((await failed.materialize(failure.id)).ok, false);
  const cancelled = createFakeTrainingBackend(options), job = accepted(await cancelled.submit(spec));
  await complete(cancelled, job.id, 2); assert.equal(accepted(await cancelled.cancel(job.id)).state, 'cancelled');
  assert.equal(accepted(await cancelled.inspect(job.id)).state, 'cancelled'); assert.equal((await cancelled.materialize(job.id)).ok, false);
  const corrupt = createFakeTrainingBackend({ ...options, corruptChecksum: true }), corruptJob = accepted(await corrupt.submit(spec));
  await complete(corrupt, corruptJob.id);
  const checked = await verifyArtifactReceipt(accepted(await corrupt.materialize(corruptJob.id)), {
    spec, job: corruptJob, runtime: receipt.runtime, maxBytes: 4096, readBytes: corrupt.readBytes,
  });
  assert.equal(checked.ok, false); if (!checked.ok) assert.equal(checked.issues[0]?.code, 'TEXP1008');
});

it('state steps and capability mismatch are explicit and unknown jobs remain unknown', async () => {
  const { spec } = await backendFixture();
  const backend = createFakeTrainingBackend({ seed: 1, stepsPerState: 2, clock: () => 0, baseModels: [spec.baseArtifactId] });
  const job = accepted(await backend.submit(spec));
  assert.deepEqual(await complete(backend, job.id, 8), ['queued', 'preparing', 'preparing', 'training', 'training', 'materializing', 'materializing', 'complete']);
  assert.equal(accepted(await backend.cancel(job.id)).state, 'complete');
  assert.equal(accepted(await backend.inspect('missing')).state, 'unknown');
  assert.equal((await backend.submit({ ...spec, baseArtifactId: 'f'.repeat(64) })).ok, false);
  assert.equal((await backend.submit({ ...spec, method: 'full' })).ok, false); assert.equal(backend.stats().submissions, 1);
  for (const invalid of ['', ' ', 'x'.repeat(257)]) for (const method of ['inspect', 'cancel', 'materialize'] as const)
    assert.equal((await backend[method](invalid)).ok, false);
});

it('all declared failure points and the longest configured runtime remain closed receipts', async () => {
  const { spec, receipt } = await backendFixture();
  for (const failAt of ['preparing', 'training', 'materializing'] as const) {
    const backend = createFakeTrainingBackend({ seed: 1, clock: () => 0, baseModels: [spec.baseArtifactId], failAt });
    const job = accepted(await backend.submit(spec)); await complete(backend, job.id);
    assert.equal(accepted(await backend.inspect(job.id)).state, 'failed'); assert.equal((await backend.materialize(job.id)).ok, false);
  }
  const backend = createFakeTrainingBackend({ seed: 1, clock: () => 0, baseModels: [spec.baseArtifactId],
    runtime: { ...receipt.runtime, servedModel: 'x'.repeat(256) } });
  const job = accepted(await backend.submit(spec)); await complete(backend, job.id);
  assert.equal(validateExperientialShape('ArtifactReceipt', accepted(await backend.materialize(job.id))).ok, true);
});
