/** Compare native database refusal metadata with the domain and inspection views. */
import assert from 'node:assert/strict';
import { CodedError } from '@jarenjs/core/errors';
import { JarenValidator } from '@jarenjs/validate';
import { createExperientialOperations, createExperientialRunner, reviseGatePolicy, verifyArtifactReceipt,
  resolveExperientialLineage, startExperientialInference, experientialSchema, type ExperientialResult } from '@tangleai/experiential';
import { openTangleDb, createExperientialDbStore, createIdentityRepository, createRunLog, enqueueExperientialTraining } from '@tangleai/store';
import { inferenceFixture } from '../experiential/inference-fixtures.ts';
import { cadenceFixture } from '../experiential/policy-fixtures.ts';
import { backendFixture } from '../experiential/backend-fixtures.ts';
import { accepted, addressedFixture } from '../experiential/identity-fixtures.ts';

let requests = 0;
globalThis.fetch = async () => { requests++; throw Error('Network is forbidden in the refusal fixture.'); };
const cadence = await cadenceFixture(), backend = await backendFixture(), policy = await addressedFixture('gatePolicy');
const db = await openTangleDb({ path: ':memory:', jobs: { now: () => cadence.clock.value, random: () => .5 } });
const store = createExperientialDbStore(db, { now: () => '2026-10-07T13:00:00.000Z' });
const operations = createExperientialOperations(store);
const input = await inferenceFixture(), identities = createIdentityRepository(db), runs = createRunLog(db);
const retainedIdentity = await identities.put(input.identity);
assert.ok(retainedIdentity.ok);
const collection = db.collection('experiential_artifacts');
await db.close();
const nativeRead = () => collection.get('0'.repeat(64));
const boundaryEffects = { policyReadCommits: 0, policyWriteAttempts: 0, nativeEnqueueAttempts: 0, retainedReservations: 0, replayWrites: 0, backendSubmissions: 0 };
const runner = await createExperientialRunner({ ...cadence.options, jobs: { enqueue: plan => {
  boundaryEffects.nativeEnqueueAttempts++; return enqueueExperientialTraining(db, plan);
} } });
const scheduler = await createExperientialRunner({ ...cadence.options, store: { ...cadence.store, schedule: async () => {
  await nativeRead(); throw Error('A closed native reader must refuse.');
} } });
let nativeCode: string | undefined;
try { await db.transaction(async () => null); }
catch (error) { assert.ok(error instanceof CodedError); nativeCode = error.code; }
assert.equal(nativeCode, 'JD2063');
try {
  const read = await store.get('artifacts', '0'.repeat(64)), snapshot = await store.snapshot('fixture');
  const reply = await operations.invoke('experiential.artifacts', { scope: 'fixture' });
  assert.ok(reply.ok);
  const inspection = reply.value as ExperientialResult<unknown>;
  const lineage = await resolveExperientialLineage(store, '0'.repeat(64));
  const hostEffects = { runAttempts: 0, pinAttempts: 0, clients: 0 };
  const host = { ...input,
    store: { pin: async (): Promise<never> => { hostEffects.pinAttempts++; throw Error('A failed host must not pin.'); } },
    startRun: async (identity: typeof input.identity) => { hostEffects.runAttempts++; return runs.startRun('native-refusal', { identityId: identity.identityId }); },
    binding: { capability: { trainable: false }, clientFor: async (): Promise<never> => { hostEffects.clients++; throw Error('A failed host must not construct a client.'); } },
  };
  const identityFailure = await startExperientialInference({ ...host, putIdentity: identity => identities.put(identity) });
  assert.equal(hostEffects.runAttempts, 0);
  const runFailure = await startExperientialInference({ ...host, putIdentity: async identity => {
    assert.equal(identity.identityId, retainedIdentity.id); return retainedIdentity;
  } });
  const policyFailure = await reviseGatePolicy({ read: async () => { await nativeRead(); return policy; }, proposal: policy,
    commit: async next => { boundaryEffects.policyReadCommits++; return { ok: true, value: next }; } });
  const policyWriteFailure = await reviseGatePolicy({ read: async () => policy, proposal: policy,
    commit: async next => { boundaryEffects.policyWriteAttempts++; await nativeRead(); return { ok: true, value: next }; } });
  const byteFailure = await verifyArtifactReceipt(backend.receipt, { spec: backend.spec, job: backend.job,
    runtime: backend.receipt.runtime, maxBytes: 10000, readBytes: async () => { await nativeRead(); return backend.bytes; } });
  const rawLineage = await resolveExperientialLineage({ get: async (): Promise<never> => {
    await nativeRead(); throw Error('A closed native reader must refuse.');
  } }, '0'.repeat(64));
  const enqueueFailure = await runner.run(cadence.trigger), scheduleFailure = await scheduler.run(cadence.trigger);
  const validate = new JarenValidator({ collectErrors: true, skipErrors: false }).compile({
    $defs: experientialSchema.$defs, $ref: '#/$defs/ExperientialIssue',
  });
  for (const [result, code] of [[read, 'TEXP1009'], [snapshot, 'TEXP1009'], [inspection, 'TEXP1009'], [lineage, 'TEXP1004'],
    [identityFailure, 'TEXP1009'], [runFailure, 'TEXP1009'], [policyFailure, 'TEXP1009'], [byteFailure, 'TEXP1008'],
    [rawLineage, 'TEXP1004'], [enqueueFailure, 'TEXP1009'], [scheduleFailure, 'TEXP1009'], [policyWriteFailure, 'TEXP1002']] as const) {
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.issues[0].code, code);
      assert.equal(validate(result.issues[0]).valid, true);
      assert.deepEqual(result.issues[0].cause, { code: nativeCode });
    }
  }
  assert.equal(requests, 0);
  assert.equal(store.stats().writes, 0);
  assert.deepEqual(hostEffects, { runAttempts: 1, pinAttempts: 0, clients: 0 });
  const beforeReplay = cadence.store.stats().writes;
  assert.equal(accepted(await cadence.runner.run(cadence.trigger)).action, 'replayed');
  boundaryEffects.replayWrites = cadence.store.stats().writes - beforeReplay;
  boundaryEffects.retainedReservations = accepted(await cadence.store.list('training_runs', cadence.base.scope)).length;
  boundaryEffects.backendSubmissions = cadence.backend.stats().submissions;
  assert.deepEqual(boundaryEffects, { policyReadCommits: 0, policyWriteAttempts: 1, nativeEnqueueAttempts: 1, retainedReservations: 1, replayWrites: 0, backendSubmissions: 0 });
  console.log(JSON.stringify({ runtime: process.versions.bun ? 'bun' : 'node', nativeCode,
    preservedRefusals: 12, physicalRequests: requests, writes: store.stats().writes, setupIdentityWrites: 1, hostEffects, boundaryEffects }));
} finally { await runner.close(); await scheduler.close(); await cadence.close(); await operations.close(); }
