import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readTrainingEnv } from '@tangleai/experiential';
import { accepted } from './identity-fixtures.ts';

export const trainingEnvironmentFixture = {
  TANGLE_TRAINING_BASE: 'https://training.example/v1', TANGLE_TRAINING_API_KEY: 'training-plan-secret-sentinel',
  TANGLE_TRAINING_DATASET_ID: 'a'.repeat(64), TANGLE_TRAINING_MANIFEST_DIGEST: 'b'.repeat(64),
  TANGLE_TRAINING_BASE_ARTIFACT_ID: 'c'.repeat(64), TANGLE_TRAINING_BASE_CHECKSUM: 'd'.repeat(64),
  TANGLE_TRAINING_METHOD: 'lora', TANGLE_TRAINING_MAX_SPEND: '5.25', TANGLE_TRAINING_MAX_WALL_MS: '60000',
};
it('the injected training environment exposes only a credential-free, frozen plan', async () => {
  const configured = accepted(readTrainingEnv(trainingEnvironmentFixture));
  assert.equal(configured.configured, true); assert.equal(configured.plan!.maxSpend, 5.25); assert.ok(Object.isFrozen(configured.plan));
  assert.equal(await configured.credential(), trainingEnvironmentFixture.TANGLE_TRAINING_API_KEY);
  assert.equal(JSON.stringify(configured).includes(trainingEnvironmentFixture.TANGLE_TRAINING_API_KEY), false);
  assert.deepEqual(accepted(readTrainingEnv({ ...trainingEnvironmentFixture, TANGLE_TRAINING_API_KEY: 'rotated-secret' })).plan, configured.plan);
  const missing = accepted(readTrainingEnv({})); assert.equal(missing.configured, false); assert.equal(missing.plan, null);
  assert.equal(missing.missing.length, 9); assert.equal(await missing.credential(), null);
});
it('malformed digests, methods and ceilings refuse without echoing supplied values', () => {
  for (const [key, value] of [
    ['TANGLE_TRAINING_BASE', 'https://private-name:private-secret@training.example'],
    ['TANGLE_TRAINING_BASE', 'https://training.example?api_key=private-secret'],
    ['TANGLE_TRAINING_DATASET_ID', 'not-a-digest'], ['TANGLE_TRAINING_METHOD', 'invented-method'],
    ['TANGLE_TRAINING_MAX_SPEND', 'NaN'], ['TANGLE_TRAINING_MAX_SPEND', '-1'],
    ['TANGLE_TRAINING_MAX_SPEND', '1e999'], ['TANGLE_TRAINING_MAX_WALL_MS', '0'],
    ['TANGLE_TRAINING_MAX_WALL_MS', '1.5'], ['TANGLE_TRAINING_MAX_WALL_MS', '9007199254740992'],
  ]) {
    const result = readTrainingEnv({ ...trainingEnvironmentFixture, [key]: value }); assert.equal(result.ok, false, key);
    if (!result.ok) assert.equal(result.issues[0]!.code, 'TEXP1001');
    assert.equal(JSON.stringify(result).includes('private-secret'), false);
  }
  assert.equal(readTrainingEnv({ TANGLE_TRAINING_BASE: 'https://name:secret@training.example' }).ok, false);
});
