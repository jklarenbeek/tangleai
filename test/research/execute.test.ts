import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExecutionManifest, createFixtureExecutor, researchExecutionResult, validateResearchExecutionResult, researchObservationSignature } from '@tangleai/research';
import { checked } from './fixtures.ts';
import { executionFixture } from './execution-fixtures.ts';

test('five registered seeds reproduce every value from the same full manifest', async () => {
  const f = await executionFixture(); let values = 0;
  for (const seed of f.contract.replicatePolicy.seeds) for (const condition of f.plan.conditions) {
    const manifest = checked(await buildExecutionManifest({ ...f.input, seed, condition: condition.id }));
    const first = checked(await f.executor.run(manifest, f.workspace, f.context));
    const second = checked(await f.executor.run(manifest, f.workspace, f.context));
    assert.deepEqual(first, second);
    const input = { ...f, manifest, result: first };
    const observations = checked(await f.registry.evaluate(input));
    assert.deepEqual(checked(await f.registry.evaluate({ ...input, result: second })), observations);
    assert.deepEqual(checked(await f.registry.registerObservations(input, observations)), observations);
    for (const observation of observations) assert.equal(observation.registrySignature, await researchObservationSignature(observation));
    assert.equal(first.run.isolation!.verified, false); values += observations.length;
  }
  assert.equal(values, 10);
});
test('program failures and cancellation are settled attempts with no observations', async () => {
  const f = await executionFixture();
  const executor = createFixtureExecutor({ [f.manifest.programId!]: async () => { throw Error('retained program failure'); } }, { now: () => 0 });
  const result = checked(await executor.run(f.manifest, f.workspace, f.context));
  assert.equal(result.run.status, 'failed'); assert.equal(result.run.stopReason, 'completed'); assert.equal(result.run.exitStatus, 1);
  assert.match(result.run.error!.cause!.detail, /retained program failure/);
  assert.equal((await f.registry.evaluate({ ...f, result })).valid, false);
  checked(await validateResearchExecutionResult(result, f.manifest, f.workspace, f.context));
  const controller = new AbortController(); controller.abort();
  const cancelled = checked(await executor.run(f.manifest, f.workspace, { ...f.context, signal: controller.signal }));
  assert.equal(cancelled.run.stopReason, 'cancelled'); assert.equal(cancelled.run.exitStatus, null);
  assert.equal(cancelled.run.output, null);
});
test('oversized raw output keeps a bounded prefix and refuses metrics', async () => {
  const f = await executionFixture();
  const manifest = checked(await buildExecutionManifest({ ...f.input, resources: { ...f.input.resources, outputBytes: 32 } }));
  const result = checked(await f.executor.run(manifest, f.workspace, f.context));
  assert.equal(result.run.stopReason, 'output-bytes'); assert.equal(result.run.status, 'failed');
  assert.equal(result.run.outputInventory![0].bytes, 32); assert.equal(result.run.output, null);
  checked(await validateResearchExecutionResult(result, manifest, f.workspace, f.context));
  assert.equal((await f.registry.evaluate({ ...f, manifest, result })).valid, false);
});
test('receipts reject changed bytes, output inventories, condition and forged run identities', async () => {
  const f = await executionFixture(), result = checked(await f.executor.run(f.manifest, f.workspace, f.context));
  const mutate = [
    (value: typeof result) => { value.run.outputInventory![0].bytes++; },
    (value: typeof result) => { value.artifacts.find(row => row.bytes.length)!.bytes[0] ^= 1; },
    (value: typeof result) => { value.run.id = 'forged-run'; },
    (value: typeof result) => { value.run.condition = 'unregistered'; },
  ];
  for (const change of mutate) {
    const changed = structuredClone(result); change(changed);
    assert.equal((await validateResearchExecutionResult(changed, f.manifest, f.workspace, f.context)).valid, false);
  }
});
test('fractional native wall timing remains precise while integral spend rounds up', async () => {
  const f = await executionFixture();
  const result = checked(await researchExecutionResult(f.manifest, { exitStatus: 1, stdout: new Uint8Array(), stderr: new Uint8Array(), files: [], output: null,
    resources: { wallMs: 143.3844, cpuMs: null, peakMemoryBytes: null }, stopReason: 'completed',
    isolation: { kind: 'container', imageDigest: f.manifest.imageDigest, verified: true, setupLogArtifactId: null, completeOutput: true }, error: null }));
  assert.equal(result.run.spend.ms, 144); assert.equal(result.run.resources!.wallMs, 143.3844);
  checked(await validateResearchExecutionResult(result, f.manifest, f.workspace, f.context));
});
