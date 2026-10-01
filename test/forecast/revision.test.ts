import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createInternalFeedbackEditor, forecastRevisionCommit, forecastQuery, forecastGet, forecastMust, forecastRevision, sealForecastRecord, selectForecastHarness, visibleHarness, prepareForecastWorkflow, forecastCheckpointFinalize, forecastCheckpointPlan, FORECAST_TABLES } from '@tangleai/forecast';
import { feedbackFixture, feedbackAnswer } from './feedback-fixture.ts';
import { scriptedClient } from './runtime-fixture.ts';
import { measureForecastRevisionResume } from '../../benchmark/lib/forecast-resume.ts';
async function edited(options: Parameters<typeof feedbackFixture>[0] = {}) {
  const f = await feedbackFixture(options), result = await createInternalFeedbackEditor({ ...f,client: scriptedClient(async () => feedbackAnswer({ provisionalDiagnoses: [],committedGuidance: [f.item],deferredFeedback: [] })) }).run(f,f.budget);
  assert.equal(result.status,'staged'); return { ...f,result };
}
it('revision publication is atomic at every write boundary and replay writes nothing',async () => {
  for (const point of ['put:forecast_revisions','put:forecast_harnesses','put:forecast_questions','put:forecast_checkpoints','commit']) {
    let fault = false;
    const f = await edited({ applyProbe: step => { if(fault && step === point) throw Error('Injected publication failure'); } });
    const before = await Promise.all(FORECAST_TABLES.map(table => forecastQuery(f.store,table)));
    fault = true; assert.equal((await forecastRevisionCommit(f.store,f.result)).ok,false,point); fault = false;
    assert.deepEqual(await Promise.all(FORECAST_TABLES.map(table => forecastQuery(f.store,table))),before,point);
    const committed = await forecastRevisionCommit(f.store,f.result); assert.equal(committed.ok,true,JSON.stringify(committed)); if (committed.ok) assert.equal(committed.writes,5);
    const replay = await forecastRevisionCommit(f.store,f.result); assert.equal(replay.ok,true); if(replay.ok) assert.equal(replay.writes,0);
  }
});
it('a revision staged at ordinal t is the input harness of ordinal t+1 and of nothing else',async () => {
  const f = await edited(), saved = forecastMust(await forecastRevisionCommit(f.store,f.result)), own = forecastMust(await forecastGet(f.store,'questions',f.question.id))!;
  const versions = forecastMust(await forecastQuery(f.store,'harnesses'));
  assert.equal(f.checkpoints[0].inputHarnessDigest,f.corpus.manifest.seedHarnessDigest); assert.equal(f.checkpoint.inputHarnessDigest,f.corpus.manifest.seedHarnessDigest);
  const next = forecastMust(await selectForecastHarness(own,'evolving-harness',versions,own.checkpointPolicy.scheduledAt[2])); assert.equal(next!.digest,f.corpus.candidates[0].digest); assert.equal(next!.id,saved.candidate!.id);
  const old = forecastMust(await selectForecastHarness(own,'evolving-harness',versions,f.checkpoints[0].scheduledAt)); assert.equal(old!.digest,f.corpus.manifest.seedHarnessDigest);
  for (const foreign of [await sealForecastRecord('questions',{ ...f.question,prompt: f.question.prompt + ' unrelated' }),await sealForecastRecord('questions',{ ...f.question,scopeKey: 'another/scope' })]) {
    const visible = visibleHarness(foreign,saved.candidate!); assert.equal(visible.ok,false); if(!visible.ok) assert.equal(visible.issues[0].code,'TFCT1003');
  }
});
it('publication refuses rehashed candidate drift and no-op feedback creates no harness',async () => {
  const f = await edited(), document = { ...f.result.candidate!.document,factorTracking: 'Overwrite unrelated procedure.' };
  const candidate = await sealForecastRecord('harnesses',{ ...f.result.candidate!,document,digest: await forecastRevision(document) });
  const revised = await sealForecastRecord('revisions',{ ...f.result.revision,candidateVersionId: candidate.id });
  const result = await forecastRevisionCommit(f.store,{ ...f.result,revision: revised,candidate }); assert.equal(result.ok,false); if(!result.ok) assert.equal(result.issues[0].code,'TFCT1007');
  const noOp = await createInternalFeedbackEditor({ ...f,client: scriptedClient(async () => feedbackAnswer({ provisionalDiagnoses: [],committedGuidance: [{ ...f.item,text: f.harness!.document.evidenceHandling }],deferredFeedback: [] })) }).run(f,f.budget);
  assert.equal(noOp.status,'deferred'); assert.equal(noOp.candidate,null); assert.equal(noOp.revision.deferredFeedback[0].reason,'duplicate-procedure');
  const saved = await forecastRevisionCommit(f.store,noOp); assert.equal(saved.ok,true); if(saved.ok) assert.equal(saved.writes,2,'only the counted revision and its purchase receipt');
  assert.equal(forecastMust(await forecastQuery(f.store,'harnesses')).length,1);
});
it('a forced stop after the revision commit resumes to the same revision and version ids without extra purchases',async () => {
  const report = await measureForecastRevisionResume(); assert.equal(report.stages.length,2); assert.equal(report.logicalCalls,14); assert.equal(report.physicalRequests,0); assert.equal(report.duplicateDeliveries,3);
  assert.ok(report.stages.every(s => s.stops === 2 && s.resumed === 2 && s.extraCalls === 0 && s.artifactDigest === report.artifactDigest));
  assert.equal(report.executableRevision,'a57678c857810999f0faab1fb9bc26952f52f5a5a9bfe865db4f277a9a9c245a');
  const workflow = await prepareForecastWorkflow('forecast-scripted'); assert.equal(workflow.plan.executableRevision,report.executableRevision);
});
