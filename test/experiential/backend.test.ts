import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkTrainingCapabilities, experientialArtifactChecksum, trainingSpecDigest, validateTrainingSpec,
  verifyArtifactReceipt, type ArtifactReceipt, type ExperientialResult } from '@tangleai/experiential';
import type { TrainingSpec } from '@tangleai/experiential';
import { backendFixture } from './backend-fixtures.ts';
import { accepted } from './identity-fixtures.ts';

function refused(result: ExperientialResult<unknown>, code = 'TEXP1008') {
  assert.equal(result.ok, false); if (result.ok) throw Error('Expected refusal.');
  assert.equal(result.issues[0]?.code, code); return result.issues;
}

it('training specs are closed, snapshot before hashing, and bind every configured input', async () => {
  const { spec } = await backendFixture();
  const original = accepted(await trainingSpecDigest(spec));
  const pending = trainingSpecDigest(spec); spec.seed++;
  assert.equal(accepted(await pending), original);
  assert.notEqual(accepted(await trainingSpecDigest(spec)), original);
  const alternatives: TrainingSpec = { datasetId: 'a'.repeat(64), manifestDigest: 'b'.repeat(64),
    baseArtifactId: 'c'.repeat(64), baseChecksum: 'd'.repeat(64), method: 'full',
    hyperparameters: { ...spec.hyperparameters, learningRate: .002 }, seed: spec.seed + 1, precision: 'bf16',
    tokenizerIdentity: 'another-tokenizer/v1', chatTemplateIdentity: 'another-chat/v1',
    budget: { ...spec.budget, maxPolls: spec.budget.maxPolls + 1 } };
  const current = accepted(await trainingSpecDigest(spec));
  for (const [key, value] of Object.entries(alternatives)) {
    assert.notEqual(accepted(await trainingSpecDigest({ ...spec, [key]: value })), current, key);
  }
  for (const input of [{ ...spec, authorization: 'secret-sentinel' }, { ...spec, seed: -1 },
    { ...spec, budget: { ...spec.budget, maxPolls: 0 } }, { ...spec, hyperparameters: { ...spec.hyperparameters, accessToken: 'secret-sentinel' } }]) {
    const issues = refused(validateTrainingSpec(input), 'TEXP1001'); assert.ok(!JSON.stringify(issues).includes('secret-sentinel'));
  }
});

it('capability admission requires training, exact base, method and artifact kind', async () => {
  const { spec, capabilities } = await backendFixture();
  assert.deepEqual(accepted(checkTrainingCapabilities(spec, capabilities)), capabilities);
  for (const change of [{ trainable: false }, { methods: ['full'] }, { baseModels: ['a'.repeat(64)] },
    { artifactKinds: ['weights'] }, { unexpected: true }]) refused(checkTrainingCapabilities(spec, { ...capabilities, ...change }));
});

it('raw artifact checksums match independent SHA-256, preserve views and ignore later mutation', async () => {
  const buffer = new Uint8Array([9, 1, 2, 3, 8]), bytes = buffer.subarray(1, 4);
  const expected = createHash('sha256').update(bytes).digest('hex');
  const pending = experientialArtifactChecksum(bytes); buffer.fill(0);
  assert.equal(await pending, expected);
});

it('receipt verification checks ancestry and runtime before fetching, then exact size and checksum', async () => {
  const { spec, job, bytes, receipt } = await backendFixture(); let reads = 0;
  const options = { spec, job, runtime: receipt.runtime, maxBytes: 4096, readBytes: async (value: ArtifactReceipt, max: number) => {
    reads++; assert.ok(Object.isFrozen(value)); assert.equal(max, 4096); return bytes;
  } };
  const result = accepted(await verifyArtifactReceipt(receipt, options));
  assert.equal(result.verifiedBytes, bytes.length); assert.deepEqual(result.receipt, receipt); assert.equal(reads, 1);
  for (const change of [{ jobId: 'another-job' }, { specDigest: 'a'.repeat(64) }, { datasetId: 'b'.repeat(64) },
    { baseArtifactId: 'c'.repeat(64) }, { baseChecksum: 'd'.repeat(64) }, { method: 'full' }, { kind: 'weights' },
    { runtime: { ...receipt.runtime, provider: 'other' } }, { runtime: { ...receipt.runtime, base: 'https://other.example/v1' } },
    { storageUri: 'https://user:secret-sentinel@example.test/a' }, { sizeBytes: 4097 }]) {
    refused(await verifyArtifactReceipt({ ...receipt, ...change }, options)); assert.equal(reads, 1);
  }
  refused(await verifyArtifactReceipt({ ...receipt, sha256: '0'.repeat(64) }, options));
  refused(await verifyArtifactReceipt({ ...receipt, sizeBytes: bytes.length + 1 }, options));
  refused(await verifyArtifactReceipt(receipt, { ...options, readBytes: async () => new Uint8Array(4097) }));
  const issues = refused(await verifyArtifactReceipt(receipt, { ...options, readBytes: async () => { throw Error('secret-sentinel'); } }));
  assert.ok(!JSON.stringify(issues).includes('secret-sentinel'));
});

it('receipt verification retains its checked inputs across the asynchronous byte reader', async () => {
  const { spec, job, bytes, receipt } = await backendFixture();
  let release!: (value: Uint8Array) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = verifyArtifactReceipt(receipt, { spec, job, runtime: receipt.runtime, maxBytes: 4096,
    readBytes: async () => { entered(); return new Promise<Uint8Array>(resolve => { release = resolve; }); } });
  await started; receipt.sha256 = 'a'.repeat(64); spec.seed++; job.id = 'later'; release(bytes);
  const value = accepted(await pending); assert.notEqual(value.receipt.sha256, receipt.sha256); assert.notEqual(value.receipt.jobId, job.id);
});
