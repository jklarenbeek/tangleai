import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvaluationRegistry, createFixtureExecutor, researchObservationSignature, researchRevisionOf } from '@tangleai/research';
import { checked, hash } from './fixtures.ts';
import { executionFixture } from './execution-fixtures.ts';

test('forgery matrix refuses each named proposal without accepting a signed assertion', async () => {
  const f = await executionFixture(), result = checked(await f.executor.run(f.manifest, f.workspace, f.context));
  const input = { ...f, result }, observations = checked(await f.registry.evaluate(input));
  for (const [name, expected] of [['forged', 'TRSH1002'], ['hardcoded', 'TRSH1006'], ['wrong-unit', 'TRSH1006'], ['wrong-condition', 'TRSH1003']] as const) {
    const rows = structuredClone(observations), row = rows[0];
    if (name === 'forged') row.registrySignature = hash();
    else if (name === 'wrong-unit') row.unit = 'invented';
    else if (name === 'wrong-condition') row.condition = 'invented';
    else {
      row.value = 1; row.registrySignature = await researchObservationSignature(row);
      row.id = 'metric-' + await researchRevisionOf({ experimentRunId: row.experimentRunId, registrySignature: row.registrySignature });
    }
    const admitted = await f.registry.registerObservations(input, rows);
    assert.equal(admitted.valid, false, name);
    if (!admitted.valid) assert.equal(admitted.issues[0].code, expected, name + JSON.stringify(admitted));
  }
  const unpinned = await createEvaluationRegistry([]).evaluate(input);
  assert.equal(unpinned.valid, false); if (!unpinned.valid) assert.equal(unpinned.issues[0].code, 'TRSH1003');
});
test('program-written metric files remain raw evidence and never evaluator observations', async () => {
  const f = await executionFixture();
  const executor = createFixtureExecutor({ [f.manifest.programId!]: async () => ({ kind: 'files', files: [{ path: 'metrics.json', content: '{"inertia":0}' }] }) }, { now: () => 0 });
  const result = checked(await executor.run(f.manifest, f.workspace, f.context));
  const value = await f.registry.evaluate({ ...f, result });
  assert.equal(value.valid, false); if (!value.valid) assert.equal(value.issues[0].code, 'TRSH1005');
});
