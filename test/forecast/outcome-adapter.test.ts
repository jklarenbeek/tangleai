import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createForecastHarnessAdapter, SEED_HARNESS, forecastRevision } from '@tangleai/forecast';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';

it('interpret is total and the miss value scores failure', async () => {
  const adapter = await createForecastHarnessAdapter(), digest = await forecastRevision(SEED_HARNESS);
  const input = { questionId: 'a'.repeat(64),checkpointId: 'b'.repeat(64),ordinal: 1,cutoffAt: '2025-01-10T00:00:00.000Z',adapter: { id: 'choice/v1',version: '1',options: ['approve','reject'] },usedHarnessDigest: digest,predictions: { [digest]: 'approve' } };
  assert.equal(adapter.score(await adapter.interpret(input,SEED_HARNESS),{ outcome: 'approve' }).outcome,'success');
  const missed = await adapter.interpret({ ...input,predictions: {} },SEED_HARNESS);
  assert.deepEqual(missed,{ answer: null,status: 'not-run-under-harness',adapter: input.adapter });
  assert.equal(adapter.score(missed,{ outcome: 'approve' }).outcome,'failure');
  const numeric = { ...input,adapter: { id: 'numeric/v1',version: '1',tolerance: 2,range: [0,30] },predictions: { [digest]: 24 } };
  assert.equal(adapter.score(await adapter.interpret(numeric,SEED_HARNESS),{ outcome: 18 }).outcome,'partial');
  assert.equal(adapter.score(await adapter.interpret({ ...numeric,predictions: { [digest]: 24.00001 } },SEED_HARNESS),{ outcome: 18 }).outcome,'failure');
});
it('the static payload is the seed harness and its adapter identity is stable', async () => {
  const fixture = await loadForecastFixtures(), adapter = await createForecastHarnessAdapter();
  assert.deepEqual(adapter.staticPayload,fixture.seed);
  assert.equal(await forecastRevision(adapter.staticPayload),fixture.manifest.seedHarnessDigest);
  assert.deepEqual(adapter.identity,(await createForecastHarnessAdapter()).identity);
  assert.equal(adapter.identity.revision,'7d8d984ef89e85c17b5c0caee65007a4e96fd6013cd2c0b2a35a9cee2cf115a5');
  assert.ok(adapter.validatePayload({ ...SEED_HARNESS,factorTracking: '🙂'.repeat(2000) }).length);
});
