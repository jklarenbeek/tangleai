import { it } from 'node:test';
import assert from 'node:assert/strict';
import { prepareForecastWorkflow, FORECAST_HANDLER_POLICY, selectForecastHarness, forecastMust, sealForecastRecord } from '@tangleai/forecast';
import { makeForecastFixture } from './fixtures.ts';
it('validates and pins the single checkpoint workflow and its task effect policies',async () => {
  const p = await prepareForecastWorkflow('forecast-scripted');
  assert.equal(p.workflow.versionId,'d77bdb098ef45490fe47537fd91fbc3276df6401e59fdb59e0e1a5de0844f259');
  assert.equal(p.plan.executableRevision,'a57678c857810999f0faab1fb9bc26952f52f5a5a9bfe865db4f277a9a9c245a');
  assert.equal(p.workflow.workflowId,'forecast-checkpoint-v1');
  for (const handler of FORECAST_HANDLER_POLICY) assert.equal(p.snapshot.document.handlers.find(h => h.id === handler.id)!.idempotency,handler.effect === 'effectful' ? 'honored' : 'not-required');
});
it('selects a scope-visible harness as of the checkpoint instant while static execution keeps the seed',async () => {
  const f = await makeForecastFixture(), question = f.questions, seed = f.harnesses;
  const provisional = await sealForecastRecord('harnesses',{ ...seed,questionId: question.id,parentVersionId: seed.id,status: 'provisional',provenance: { seed: false,revisionId: null,retrospectiveId: null },recordedAt: '2025-01-17T00:00:00.000Z' });
  const foreign = await sealForecastRecord('harnesses',{ ...provisional,questionId: 'f'.repeat(64),recordedAt: '2025-01-18T00:00:00.000Z' });
  const checked = await sealForecastRecord('harnesses',{ ...seed,questionId: null,status: 'checked-ref',checkedVersionId: 'b'.repeat(64),provenance: { seed: false,revisionId: null,retrospectiveId: null },recordedAt: '2025-01-15T00:00:00.000Z' });
  for (const [at,expected] of [['2025-01-10T00:00:00.000Z',seed],['2025-01-16T00:00:00.000Z',checked],['2025-01-17T00:00:00.000Z',provisional],['2025-01-18T00:00:00.000Z',provisional]] as const)
    assert.equal(forecastMust(await selectForecastHarness(question,'evolving-harness',[foreign,provisional,checked,seed],at))!.id,expected.id);
  assert.equal(forecastMust(await selectForecastHarness(question,'static-harness',[foreign,provisional,checked,seed],'2025-01-18T00:00:00.000Z'))!.id,seed.id);
  assert.equal(forecastMust(await selectForecastHarness(question,'no-harness',[seed],'2025-01-18T00:00:00.000Z')),null);
});
