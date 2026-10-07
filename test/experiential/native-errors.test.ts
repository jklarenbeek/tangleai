import assert from 'node:assert/strict';
import { it } from 'node:test';
import { CodedError } from '@jarenjs/core/errors';
import { JarenValidator } from '@jarenjs/validate';
import { createExperientialOperations, createExperientialStoreAdapter, createExperientialRunner, resolveExperientialLineage, startExperientialInference,
  reviseGatePolicy, verifyArtifactReceipt,
  experientialIssue, experientialSchema, type ExperientialResult } from '@tangleai/experiential';
import { inferenceFixture } from './inference-fixtures.ts';
import { cadenceFixture } from './policy-fixtures.ts';
import { backendFixture } from './backend-fixtures.ts';
import { accepted, addressedFixture } from './identity-fixtures.ts';

const sentinel = 'PRIVATE_NATIVE_DIAGNOSTIC_731';
const native = () => new CodedError('DbRuntimeError', 'JD2063', sentinel,
  { docPath: '/' + sentinel, dataPath: '/' + sentinel }, { cause: new Error(sentinel) });
const storeFor = (error: unknown) => createExperientialStoreAdapter({ async transaction() { throw error; } },
  { now: () => '2026-10-07T13:00:00.000Z' });

it('retains a native persistence refusal code without publishing diagnostic payloads', async () => {
  const store = storeFor(native());
  const result = await store.get('artifacts', '0'.repeat(64));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0].code, 'TEXP1009');
    assert.deepEqual(result.issues[0].cause, { code: 'JD2063' });
  }
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.deepEqual(store.stats(), { transactions: 1, writes: 0, activations: 0 });
});

it('keeps unclassified errors and unsafe diagnostic codes opaque and counted', async () => {
  for (const error of [new Error(sentinel), { code: sentinel, message: sentinel },
    new CodedError('HostError', 'secret=' + sentinel, sentinel)]) {
    const store = storeFor(error), result = await store.snapshot('fixture');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0].code, 'TEXP1009');
      assert.equal(result.issues[0].cause, undefined);
    }
    assert.ok(!JSON.stringify(result).includes(sentinel));
    assert.deepEqual(store.stats(), { transactions: 1, writes: 0, activations: 0 });
  }
});

it('keeps inherited native refusals inside the closed issue schema through lineage and another wrapper', async () => {
  const result = await resolveExperientialLineage(storeFor(native()), '0'.repeat(64));
  assert.equal(result.ok, false);
  if (result.ok) throw Error('Expected a lineage refusal.');
  assert.equal(result.issues[0].code, 'TEXP1004');
  const wrapped = experientialIssue('TEXP1012', '/lineage', 'A retention input could not be verified.', result.issues[0]);
  const validate = new JarenValidator({ collectErrors: true, skipErrors: false }).compile({
    $defs: experientialSchema.$defs, $ref: '#/$defs/ExperientialIssue',
  });
  for (const issue of [result.issues[0], wrapped]) {
    const validation = validate(issue);
    assert.equal(validation.valid, true, JSON.stringify(validation));
    assert.deepEqual(issue.cause, { code: 'JD2063' });
    assert.ok(!JSON.stringify(issue).includes(sentinel));
  }
});

it('preserves a coded store failure through read-only native dispatch without exposing its detail', async () => {
  const store = storeFor(native());
  const operations = createExperientialOperations({ ...store, async snapshot() { throw native(); } });
  try {
    const reply = await operations.invoke('experiential.artifacts', { scope: 'fixture' });
    assert.ok(reply.ok);
    const result = reply.value as ExperientialResult<unknown>;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0].code, 'TEXP1009');
      assert.deepEqual(result.issues[0].cause, { code: 'JD2063' });
    }
    assert.ok(!JSON.stringify(reply).includes(sentinel));
    assert.equal(store.stats().writes, 0);
  } finally { await operations.close(); }
});

it('keeps a native inference host refusal private and stops before run, pin and client effects', async () => {
  const input = await inferenceFixture(); let laterEffects = 0;
  const forbidden = async (): Promise<never> => { laterEffects++; throw Error('The failed identity write must stop host startup.'); };
  const result = await startExperientialInference({ ...input, putIdentity: async () => { throw native(); },
    startRun: forbidden, store: { pin: forbidden }, binding: { capability: { trainable: false }, clientFor: forbidden } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.issues[0].code, 'TEXP1009');
    assert.deepEqual(result.issues[0].cause, { code: 'JD2063' });
  }
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.equal(laterEffects, 0);
});

it('preserves classified reader failures across policy, artifact bytes and raw lineage without disclosing diagnostics', async () => {
  const policy = await addressedFixture('gatePolicy'), backend = await backendFixture();
  for (const error of [native(), new Error(sentinel), { code: 'JD2063', message: sentinel }]) {
    const fail = async (): Promise<never> => { throw error; };
    const results = [
      await reviseGatePolicy({ read: fail, proposal: policy, commit: async () => { assert.fail('A failed read must not publish.'); } }),
      await verifyArtifactReceipt(backend.receipt, { spec: backend.spec, job: backend.job, runtime: backend.receipt.runtime,
        maxBytes: 10000, readBytes: fail }),
      await resolveExperientialLineage({ get: fail }, '0'.repeat(64)),
    ];
    for (const [i, result] of results.entries()) {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.issues[0].code, ['TEXP1009', 'TEXP1008', 'TEXP1004'][i]);
        if (error instanceof CodedError) assert.deepEqual(result.issues[0].cause, { code: 'JD2063' });
        else assert.equal(result.issues[0].cause?.code, i === 0 ? 'GUARDED' : undefined);
      }
      assert.ok(!JSON.stringify(result).includes(sentinel));
    }
  }
});

it('retains private native scheduling and enqueue causes while preserving one replayable outbox reservation', async () => {
  for (const error of [native(), new CodedError('DbRuntimeError', 'JD2063', 'closed'), new Error(sentinel)]) {
    const f = await cadenceFixture({ computeBudget: { maxRunsPerDay: 1, maxSpend: null } });
    const fail = async (): Promise<never> => { throw error; };
    const runner = await createExperientialRunner({ ...f.options, jobs: { enqueue: fail } });
    const scheduler = await createExperientialRunner({ ...f.options, store: { ...f.store, schedule: fail } });
    try {
      for (const [result, path] of [[await runner.run(f.trigger), '/jobs'], [await scheduler.run(f.trigger), '/runner']] as const) {
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.issues[0].code, 'TEXP1009'); assert.equal(result.issues[0].path, path);
          assert.deepEqual(result.issues[0].cause, error instanceof CodedError ? { code: 'JD2063' } : undefined);
        }
        assert.ok(!JSON.stringify(result).includes(sentinel));
      }
      const writes = f.store.stats().writes;
      assert.equal(accepted(await f.runner.run(f.trigger)).action, 'replayed');
      assert.equal(f.store.stats().writes, writes); assert.equal(f.jobs.size, 1);
      assert.equal(accepted(await f.store.list('training_runs', f.base.scope)).length, 1);
      assert.equal(f.backend.stats().submissions, 0);
    } finally { await runner.close(); await scheduler.close(); await f.close(); }
  }
});

it('keeps thrown policy publication diagnostics private while retaining their native code', async () => {
  const policy = await addressedFixture('gatePolicy');
  for (const error of [native(), { code: 'secret=' + sentinel, docPath: '/' + sentinel, message: sentinel }]) {
    let attempts = 0;
    const result = await reviseGatePolicy({ read: async () => policy, proposal: policy,
      commit: async () => { attempts++; throw error; } });
    assert.equal(result.ok, false); assert.equal(attempts, 1);
    if (!result.ok) {
      assert.equal(result.issues[0].code, 'TEXP1002');
      if (error instanceof CodedError) assert.deepEqual(result.issues[0].cause, { code: 'JD2063' });
      else assert.equal(result.issues[0].cause?.code, 'GUARDED');
    }
    assert.ok(!JSON.stringify(result).includes(sentinel));
  }
});
